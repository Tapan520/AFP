using System.Security.Cryptography;
using System.Text;
using AFP.Pages;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AFP.Tests;

public class PaymentModelTests
{
    private static PaymentModel CreateModel(Dictionary<string, string?>? settings = null)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        return new PaymentModel(cfg, new StubHttpClientFactory(), NullLogger<PaymentModel>.Instance);
    }

    private static T Get<T>(object obj, string prop)
    {
        var p = obj.GetType().GetProperty(prop)
                ?? throw new InvalidOperationException($"Property '{prop}' not found.");
        return (T)p.GetValue(obj)!;
    }

    [Fact]
    public void FeeConstants_HaveExpectedDefaults()
    {
        Assert.Equal(200, PaymentModel.FeeRegistration);
        Assert.Equal(150, PaymentModel.FeeRenewal);
        Assert.Equal(100, PaymentModel.FeeTransfer);
        Assert.Equal("INR", PaymentModel.Currency);
    }

    [Fact]
    public async Task OnPostCreateOrderAsync_TestMode_ReturnsSyntheticOrder()
    {
        var model = CreateModel(new Dictionary<string, string?>
        {
            ["Payment:TestMode"] = "true",
        });

        var result = await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "registration", PetName = "Rex" });

        var json    = Assert.IsType<JsonResult>(result);
        var payload = json.Value!;

        Assert.True(Get<bool>(payload, "testMode"));
        Assert.Equal("rzp_test_mode", Get<string>(payload, "keyId"));
        Assert.Equal(200 * 100, Get<int>(payload, "amount"));
        Assert.Equal("INR", Get<string>(payload, "currency"));
        Assert.Equal("registration", Get<string>(payload, "purpose"));
        Assert.Equal("Rex", Get<string>(payload, "petName"));
        Assert.StartsWith("TEST_ORDER_", Get<string>(payload, "orderId"));
    }

    [Theory]
    [InlineData("registration", 200)]
    [InlineData("renewal",      150)]
    [InlineData("transfer",     100)]
    [InlineData("unknown",      200)] // defaults to registration
    public async Task OnPostCreateOrderAsync_TestMode_UsesCorrectFeeForPurpose(string purpose, int rupees)
    {
        var model = CreateModel(new Dictionary<string, string?>
        {
            ["Payment:TestMode"] = "true",
        });

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = purpose });

        Assert.Equal(rupees * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public void OnPostVerify_TestOrderPrefix_AutoApprovesWithoutSecret()
    {
        var model = CreateModel();
        var req = new VerifyRequest
        {
            OrderId   = "TEST_ORDER_20250101000000_abc",
            PaymentId = "pay_test_1",
            Signature = "irrelevant",
        };

        var result  = (JsonResult)model.OnPostVerify(req);
        var payload = result.Value!;

        Assert.True(Get<bool>(payload, "verified"));
        Assert.True(Get<bool>(payload, "testMode"));
        Assert.Equal(req.OrderId, Get<string>(payload, "orderId"));
        Assert.StartsWith("TEST-PAY-", Get<string>(payload, "txnRef"));
    }

    [Fact]
    public void OnPostVerify_ValidSignature_ReturnsVerifiedTrue()
    {
        const string secret = "test_secret_key";
        var model = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:KeySecret"] = secret,
        });

        var orderId   = "order_9A0abc";
        var paymentId = "pay_9A0xyz";
        var signature = ComputeHmacHex(secret, $"{orderId}|{paymentId}");

        var result  = (JsonResult)model.OnPostVerify(new VerifyRequest
        {
            OrderId   = orderId,
            PaymentId = paymentId,
            Signature = signature,
        });
        var payload = result.Value!;

        Assert.True(Get<bool>(payload, "verified"));
        Assert.False(Get<bool>(payload, "testMode"));
        Assert.Equal($"RZP-{paymentId}", Get<string>(payload, "txnRef"));
    }

    [Fact]
    public void OnPostVerify_InvalidSignature_Returns400()
    {
        var model = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:KeySecret"] = "test_secret_key",
        });

        var result = (JsonResult)model.OnPostVerify(new VerifyRequest
        {
            OrderId   = "order_9A0abc",
            PaymentId = "pay_9A0xyz",
            Signature = new string('0', 64),
        });

        Assert.Equal(400, result.StatusCode);
        Assert.False(Get<bool>(result.Value!, "verified"));
    }

    [Fact]
    public void OnPostVerify_MissingSecret_Returns500()
    {
        var model = CreateModel();
        var result = model.OnPostVerify(new VerifyRequest
        {
            OrderId   = "order_9A0abc",
            PaymentId = "pay_9A0xyz",
            Signature = "abc",
        });
        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, status.StatusCode);
    }

    private static string ComputeHmacHex(string key, string message)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message)))
                      .ToLowerInvariant();
    }

    // ── Per-nigam fee resolution tests ──────────────────────────────────────
    // ResolveFeeAsync is internal virtual; we subclass and stub the network hop.

    private sealed class StubbedPaymentModel : PaymentModel
    {
        public Dictionary<int, (int reg, int ren, int trf)> Fees { get; } = new();
        // Species/size-aware overrides. Key = (nigamId, purpose, species, sizeCategory).
        // When set, this wins over the flat `Fees` dict — mirrors the server-side
        // rule → nigam → default fallback chain.
        public Dictionary<(int nigamId, string purpose, string species, string size), int> RuleFees { get; } = new();

        public StubbedPaymentModel(IConfiguration cfg)
            : base(cfg, new StubHttpClientFactory(), NullLogger<PaymentModel>.Instance) { }

        internal override Task<int> ResolveFeeAsync(string purpose, int? nigamId, string? species = null, string? breed = null)
        {
            if (nigamId is null) return base.ResolveFeeAsync(purpose, null, species, breed);

            // Tier-1 shim: rule lookup keyed on the classified (species, size).
            if (!string.IsNullOrEmpty(species))
            {
                var sp   = species.ToLowerInvariant() switch { "dog" => "dog", "cat" => "cat", _ => "other" };
                var b    = (breed ?? "").ToLowerInvariant();
                string size;
                if (sp != "dog")                                   size = "single";
                else if (b.Contains("rottweiler") || b.Contains("pitbull") ||
                         b.Contains("german shepherd") || b.Contains("labrador") ||
                         b.Contains("great dane"))                 size = "large_aggressive";
                else                                               size = "small";
                if (RuleFees.TryGetValue((nigamId.Value, purpose, sp, size), out var ruleRupees))
                    return Task.FromResult(ruleRupees);
            }

            if (!Fees.TryGetValue(nigamId.Value, out var f))
                return base.ResolveFeeAsync(purpose, null, species, breed);
            var rupees = purpose switch
            {
                "renewal"  => f.ren,
                "transfer" => f.trf,
                _          => f.reg,
            };
            return Task.FromResult(rupees);
        }
    }

    [Fact]
    public async Task OnPostCreateOrderAsync_TestMode_UsesPerNigamRegistrationFee()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[42] = (reg: 350, ren: 250, trf: 150);

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "registration", NigamId = 42 });

        Assert.Equal(350 * 100, Get<int>(result.Value!, "amount"));
        Assert.Equal(42,        Get<int?>(result.Value!, "nigamId"));
    }

    [Theory]
    [InlineData("registration", 350)]
    [InlineData("renewal",      250)]
    [InlineData("transfer",     150)]
    public async Task OnPostCreateOrderAsync_TestMode_UsesPerNigamFeeForEachPurpose(string purpose, int rupees)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[7] = (reg: 350, ren: 250, trf: 150);

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = purpose, NigamId = 7 });

        Assert.Equal(rupees * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task OnPostCreateOrderAsync_TestMode_UnknownNigam_FallsBackToConfigThenConstant()
    {
        // With no per-nigam fee AND an appsettings override, the appsettings
        // value wins (middle tier of the fallback chain).
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Payment:TestMode"]        = "true",
                ["Payment:RegistrationFee"] = "275",
            }).Build();
        var model = new StubbedPaymentModel(cfg); // Fees dict is empty

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "registration", NigamId = 999 });

        Assert.Equal(275 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task OnPostCreateOrderAsync_TestMode_NoNigamId_FallsBackToConstant()
    {
        // No per-nigam value, no config override → hard-coded FeeRegistration.
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "registration" });

        Assert.Equal(PaymentModel.FeeRegistration * 100, Get<int>(result.Value!, "amount"));
    }

    // ── Per-species / size fee resolution ────────────────────────────────
    // Verifies the 4-tier fallback (rule → nigam flat → appsettings → const)
    // for the species+breed matrix requested by the product owner.

    [Fact]
    public async Task ResolveFee_LargeAggressiveDog_UsesRuleFee()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 200, ren: 150, trf: 100);      // flat fallback
        model.RuleFees[(5, "registration", "dog", "large_aggressive")] = 500;

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "registration", NigamId = 5,
                Species = "dog", Breed = "Rottweiler",
            });

        Assert.Equal(500 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task ResolveFee_SmallDog_UsesRuleFee()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 200, ren: 150, trf: 100);
        model.RuleFees[(5, "registration", "dog", "small")] = 300;

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "registration", NigamId = 5,
                Species = "dog", Breed = "Pomeranian",  // not in large list
            });

        Assert.Equal(300 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task ResolveFee_Cat_UsesSingleRuleFee()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 200, ren: 150, trf: 100);
        model.RuleFees[(5, "registration", "cat", "single")] = 220;

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "registration", NigamId = 5,
                Species = "cat", Breed = "Persian",
            });

        Assert.Equal(220 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task ResolveFee_Rabbit_ClassifiedAsOther()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 200, ren: 150, trf: 100);
        model.RuleFees[(5, "registration", "other", "single")] = 150;

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "registration", NigamId = 5,
                Species = "rabbit",
            });

        Assert.Equal(150 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task ResolveFee_NoRuleForDog_FallsBackToFlatNigamFee()
    {
        // Dog + breed given, but no rule row exists → tier-2 flat fee wins.
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 275, ren: 225, trf: 175); // flat only

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "registration", NigamId = 5,
                Species = "dog", Breed = "German Shepherd",
            });

        Assert.Equal(275 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task ResolveFee_RenewalOfLargeDog_UsesRuleRenewalFee()
    {
        // Q5: existing pets renew at the new species/size rate.
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var model = new StubbedPaymentModel(cfg);
        model.Fees[5] = (reg: 200, ren: 150, trf: 100);
        model.RuleFees[(5, "renewal", "dog", "large_aggressive")] = 350;

        var result = (JsonResult)await model.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "renewal", NigamId = 5,
                Species = "dog", Breed = "Pitbull",
            });

        Assert.Equal(350 * 100, Get<int>(result.Value!, "amount"));
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new HttpClient();
    }
}
