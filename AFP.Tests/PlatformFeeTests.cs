using System.Security.Cryptography;
using System.Text;
using AFP.Pages;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AFP.Tests;

/// <summary>
/// Phase 1 tests — dual Razorpay routing (Municipal vs Platform) and the
/// platform-fee resolution tier used for doctor / shop directory listings.
///
/// The .NET server never talks to Razorpay directly here; we exercise the
/// credential-picker and the test-mode order path which reuses the same
/// fee-resolution + purpose-routing logic that production uses.
/// </summary>
public class PlatformFeeTests
{
    // ── Static asset presence checks (Node + JS) ─────────────────────────────
    // These give us high-confidence smoke tests without booting the servers.

    private static readonly string RepoRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    [Fact]
    public void PlatformFeesRoute_ExistsAndMountedInServer()
    {
        var route = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "platformFees.js"));
        Assert.Contains("doctor_registration", route);
        Assert.Contains("doctor_renewal",      route);
        Assert.Contains("shop_registration",   route);
        Assert.Contains("shop_renewal",        route);
        Assert.Contains("platform_fees",       route);
        Assert.Contains("platform_fee_history",route);
        // Write route MUST be super_admin only
        Assert.Contains("requireRole(\"super_admin\")", route);

        var server = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "server.js"));
        Assert.Contains("platformFeesRouter",     server);
        Assert.Contains("/api/platform-fees",     server);
        // Migration table creation
        Assert.Contains("CREATE TABLE IF NOT EXISTS platform_fees",         server);
        Assert.Contains("CREATE TABLE IF NOT EXISTS platform_fee_history",  server);
    }

    [Fact]
    public void FeesUi_ExposesPlatformFeesSectionForSuperAdminOnly()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-fees.js"));
        Assert.Contains("_platformFeesCardHTML", js);
        Assert.Contains("/api/platform-fees",    js);
        Assert.Contains("savePlatformFees",      js);
        Assert.Contains("openPlatformHistory",   js);
        // Gated by isSA in _render()
        Assert.Contains("if (isSA && _platformFees)", js);
    }

    // ── Purpose-classification helper ────────────────────────────────────────
    [Theory]
    [InlineData("registration",          false)]
    [InlineData("renewal",               false)]
    [InlineData("transfer",              false)]
    [InlineData("doctor_registration",   true)]
    [InlineData("doctor_renewal",        true)]
    [InlineData("shop_registration",     true)]
    [InlineData("shop_renewal",          true)]
    [InlineData("SHOP_REGISTRATION",     true)] // case-insensitive
    [InlineData(null,                    false)]
    [InlineData("",                      false)]
    public void IsPlatformPurpose_ClassifiesCorrectly(string? purpose, bool expected)
    {
        Assert.Equal(expected, PaymentModel.IsPlatformPurpose(purpose));
    }

    // ── Dual-account credential routing ──────────────────────────────────────
    [Fact]
    public void ResolveRazorpayCredentials_PetPurpose_UsesMunicipalScope()
    {
        var m = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:Municipal:KeyId"]     = "rzp_muni_id",
            ["Razorpay:Municipal:KeySecret"] = "rzp_muni_secret",
            ["Razorpay:Platform:KeyId"]      = "rzp_plat_id",
            ["Razorpay:Platform:KeySecret"]  = "rzp_plat_secret",
        });
        var (k, s) = m.ResolveRazorpayCredentials("registration");
        Assert.Equal("rzp_muni_id",     k);
        Assert.Equal("rzp_muni_secret", s);
    }

    [Fact]
    public void ResolveRazorpayCredentials_DoctorPurpose_UsesPlatformScope()
    {
        var m = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:Municipal:KeyId"]     = "rzp_muni_id",
            ["Razorpay:Municipal:KeySecret"] = "rzp_muni_secret",
            ["Razorpay:Platform:KeyId"]      = "rzp_plat_id",
            ["Razorpay:Platform:KeySecret"]  = "rzp_plat_secret",
        });
        var (k, s) = m.ResolveRazorpayCredentials("doctor_registration");
        Assert.Equal("rzp_plat_id",     k);
        Assert.Equal("rzp_plat_secret", s);
    }

    [Fact]
    public void ResolveRazorpayCredentials_FallsBackToLegacyKeys_WhenScopedMissing()
    {
        // Existing deployments have only Razorpay:KeyId / KeySecret. Both
        // Municipal and Platform purposes should resolve to those values so
        // nothing breaks the day this code ships.
        var m = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:KeyId"]     = "rzp_legacy_id",
            ["Razorpay:KeySecret"] = "rzp_legacy_secret",
        });
        var (kMuni, sMuni) = m.ResolveRazorpayCredentials("registration");
        var (kPlat, sPlat) = m.ResolveRazorpayCredentials("doctor_registration");
        Assert.Equal("rzp_legacy_id",     kMuni);
        Assert.Equal("rzp_legacy_secret", sMuni);
        Assert.Equal("rzp_legacy_id",     kPlat);
        Assert.Equal("rzp_legacy_secret", sPlat);
    }

    [Fact]
    public void ResolveRazorpayCredentials_MissingConfig_Throws()
    {
        var m = CreateModel();
        Assert.Throws<InvalidOperationException>(
            () => m.ResolveRazorpayCredentials("registration"));
    }

    // ── Verify picks the right secret per purpose ────────────────────────────
    [Fact]
    public void OnPostVerify_PlatformPurpose_ValidatesUsingPlatformSecret()
    {
        const string platSecret = "plat_secret_key";
        var m = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:Municipal:KeySecret"] = "muni_secret_key",
            ["Razorpay:Platform:KeySecret"]  = platSecret,
        });
        var orderId   = "order_doc_1";
        var paymentId = "pay_doc_1";
        var sig       = ComputeHmacHex(platSecret, $"{orderId}|{paymentId}");

        var result = (JsonResult)m.OnPostVerify(new VerifyRequest
        {
            OrderId   = orderId,
            PaymentId = paymentId,
            Signature = sig,
            Purpose   = "doctor_registration",
        });
        Assert.True(Get<bool>(result.Value!, "verified"));
    }

    [Fact]
    public void OnPostVerify_PurposeSecretsCrossed_FailsWith400()
    {
        // Signature signed with Municipal secret but caller claims a Platform
        // purpose → must fail (protects against tenant confusion).
        const string muniSecret = "muni_secret_key";
        const string platSecret = "plat_secret_key";
        var m = CreateModel(new Dictionary<string, string?>
        {
            ["Razorpay:Municipal:KeySecret"] = muniSecret,
            ["Razorpay:Platform:KeySecret"]  = platSecret,
        });
        var orderId   = "order_x";
        var paymentId = "pay_x";
        var wrongSig  = ComputeHmacHex(muniSecret, $"{orderId}|{paymentId}");

        var result = (JsonResult)m.OnPostVerify(new VerifyRequest
        {
            OrderId   = orderId,
            PaymentId = paymentId,
            Signature = wrongSig,
            Purpose   = "shop_registration",
        });
        Assert.Equal(400, result.StatusCode);
    }

    // ── Platform-fee resolution ──────────────────────────────────────────────
    // Stub out the network hop so we can exercise the config-override + hard-
    // coded-constant fallback tiers deterministically.
    private sealed class StubbedPaymentModel : PaymentModel
    {
        public Dictionary<string, int> PlatformFees { get; } = new();

        public StubbedPaymentModel(IConfiguration cfg)
            : base(cfg, new StubHttpClientFactory(), NullLogger<PaymentModel>.Instance) { }

        internal override Task<int> ResolvePlatformFeeAsync(string purpose)
        {
            if (PlatformFees.TryGetValue(purpose ?? "", out var v)) return Task.FromResult(v);
            return base.ResolvePlatformFeeAsync(purpose ?? "");
        }
    }

    [Theory]
    [InlineData("doctor_registration", 500)]
    [InlineData("doctor_renewal",      300)]
    [InlineData("shop_registration",   300)]
    [InlineData("shop_renewal",        200)]
    public async Task PlatformFee_DefaultsMatchNodeFallbacks(string purpose, int rupees)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var m = new StubbedPaymentModel(cfg);

        var result = (JsonResult)await m.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = purpose });

        Assert.Equal(rupees * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task PlatformFee_HonoursAppSettingsOverride_WhenPlatformLookupFails()
    {
        // No stub value → falls through to appsettings override.
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Payment:TestMode"]                 = "true",
                ["Payment:DoctorRegistrationFee"]    = "750",
            })
            .Build();
        var m = new StubbedPaymentModel(cfg);

        var result = (JsonResult)await m.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "doctor_registration" });

        Assert.Equal(750 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task PlatformFee_UsesStubbedPlatformValue_WhenPresent()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var m = new StubbedPaymentModel(cfg);
        m.PlatformFees["shop_registration"] = 425;

        var result = (JsonResult)await m.OnPostCreateOrderAsync(
            new CreateOrderRequest { Purpose = "shop_registration" });

        Assert.Equal(425 * 100, Get<int>(result.Value!, "amount"));
    }

    [Fact]
    public async Task PlatformFee_DoesNotUseNigamFeeChain_EvenIfNigamIdProvided()
    {
        // A doctor signup with a stale nigamId in the request must NOT resolve
        // to the per-nigam pet fee. Directory fees are portal-wide.
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Payment:TestMode"] = "true" })
            .Build();
        var m = new StubbedPaymentModel(cfg);
        m.PlatformFees["doctor_registration"] = 600;

        var result = (JsonResult)await m.OnPostCreateOrderAsync(
            new CreateOrderRequest {
                Purpose = "doctor_registration",
                NigamId = 42,     // should be ignored
                Species = "dog",  // should be ignored
                Breed   = "Rottweiler",
            });

        Assert.Equal(600 * 100, Get<int>(result.Value!, "amount"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
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

    private static string ComputeHmacHex(string key, string message)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message)))
                      .ToLowerInvariant();
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new HttpClient();
    }
}
