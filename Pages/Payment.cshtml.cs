using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AFP.Pages
{
    /// <summary>
    /// Secure server-side proxy for Razorpay.
    /// POST /api/payment?handler=CreateOrder  ? creates Razorpay order (Key Secret stays on server)
    /// POST /api/payment?handler=Verify       ? verifies HMAC-SHA256 signature
    ///
    /// Two-account routing (added Phase 1, backward compatible):
    ///   • "registration" / "renewal" / "transfer" —→ Municipal Razorpay account
    ///     (fees flow to the Nigam's bank account — pets are a municipal levy).
    ///   • "doctor_registration" / "doctor_renewal" / "shop_registration"
    ///     / "shop_renewal" —→ Platform Razorpay account (fees flow to AFP).
    ///
    /// Config precedence for each account:
    ///   Razorpay:Municipal:KeyId / KeySecret          (preferred, new)
    ///   Razorpay:KeyId          / KeySecret            (legacy fallback)
    /// The legacy pair keeps existing deployments working with zero config
    /// change until the AFP Razorpay merchant account is provisioned.
    ///
    /// Razorpay Route (multi-tenant split, added Phase 2):
    ///   For municipal purposes, when
    ///     • the Nigam has a linked account (razorpay_account_id), AND
    ///     • Razorpay:Platform:LinkedAccountId is configured, AND
    ///     • Payment:PlatformFeePct > 0
    ///   the order is created with a transfers[] array that credits the
    ///   Nigam's bank directly and routes a platform commission to AFP's
    ///   linked account. When any of the above is missing we transparently
    ///   fall back to a plain single-account order (previous behavior).
    /// </summary>
    [IgnoreAntiforgeryToken]
    public class PaymentModel : PageModel
    {
        public const int FeeRegistration = 200;
        public const int FeeRenewal      = 150;
        public const int FeeTransfer     = 100;
        // Platform-fee defaults (doctor / shop directory) — mirror the Node
        // fallback in routes/platformFees.js so the two backends stay aligned.
        public const int FeeDoctorRegistration = 500;
        public const int FeeDoctorRenewal      = 300;
        public const int FeeShopRegistration   = 300;
        public const int FeeShopRenewal        = 200;
        public const string Currency     = "INR";

        // Purposes that route to the AFP-owned platform Razorpay account.
        private static readonly HashSet<string> PlatformPurposes = new(StringComparer.OrdinalIgnoreCase)
        {
            "doctor_registration", "doctor_renewal",
            "shop_registration",   "shop_renewal",
        };

        internal static bool IsPlatformPurpose(string? purpose) =>
            purpose is not null && PlatformPurposes.Contains(purpose);

        private const string TestOrderPrefix = "TEST_ORDER_";

        private readonly IConfiguration       _cfg;
        private readonly IHttpClientFactory   _http;
        private readonly ILogger<PaymentModel> _log;

        public PaymentModel(IConfiguration cfg, IHttpClientFactory http, ILogger<PaymentModel> log)
        {
            _cfg  = cfg;
            _http  = http;
            _log   = log;
        }

        public void OnGet() { }

        // POST /api/payment?handler=CreateOrder
        public async Task<IActionResult> OnPostCreateOrderAsync([FromBody] CreateOrderRequest req)
        {
            bool testMode = _cfg.GetValue<bool>("Payment:TestMode", false);

            // Fee resolution — route by purpose:
            //   • Municipal purposes (pet registration/renewal/transfer)
            //     use the existing 4-tier chain (rule → nigam → config → const).
            //   • Platform purposes (doctor_* / shop_*) use the platform-fee
            //     lookup (platform table → config → const). NigamId is ignored
            //     for these because the fee is portal-wide, not per-city.
            int amountRupees = IsPlatformPurpose(req.Purpose)
                ? await ResolvePlatformFeeAsync(req.Purpose)
                : await ResolveFeeAsync(req.Purpose, req.NigamId, req.Species, req.Breed);
            int amountPaise  = amountRupees * 100;
            string currency  = _cfg["Payment:Currency"] ?? Currency;

            // ── Razorpay Route split (municipal purposes only) ─────────────
            // For a Nigam-bound payment we try to route funds directly:
            //   • Nigam linked account   → amountPaise − platformCut
            //   • Platform linked account → platformCut  (AFP commission)
            // When any prerequisite is missing (no linked account for the
            // Nigam, no platform linked account configured, or fee % is 0)
            // we fall back to a single-account order — preserving existing
            // behavior and keeping all current tests green.
            List<TransferSpec>? transfers = null;
            int platformCutPaise = 0;
            string? nigamLinkedAccountId = null;
            if (!IsPlatformPurpose(req.Purpose) && req.NigamId is > 0)
            {
                nigamLinkedAccountId = await ResolveNigamLinkedAccountAsync(req.NigamId.Value);
                var platformLinkedAccountId = _cfg["Razorpay:Platform:LinkedAccountId"];
                decimal feePct = _cfg.GetValue<decimal>("Payment:PlatformFeePct", 0m);
                if (!string.IsNullOrWhiteSpace(nigamLinkedAccountId)
                    && !string.IsNullOrWhiteSpace(platformLinkedAccountId)
                    && feePct > 0m)
                {
                    platformCutPaise = (int)Math.Round(amountPaise * feePct / 100m);
                    if (platformCutPaise < 0) platformCutPaise = 0;
                    if (platformCutPaise > amountPaise) platformCutPaise = amountPaise;
                    var nigamCutPaise = amountPaise - platformCutPaise;
                    transfers = new List<TransferSpec>
                    {
                        new() {
                            Account  = nigamLinkedAccountId!,
                            Amount   = nigamCutPaise,
                            Currency = currency,
                            Notes    = new Dictionary<string, string> {
                                ["purpose"] = req.Purpose ?? "",
                                ["petName"] = req.PetName ?? "",
                                ["nigamId"] = req.NigamId.ToString() ?? "",
                            },
                        },
                    };
                    if (platformCutPaise > 0)
                    {
                        transfers.Add(new TransferSpec
                        {
                            Account  = platformLinkedAccountId!,
                            Amount   = platformCutPaise,
                            Currency = currency,
                            Notes    = new Dictionary<string, string> {
                                ["purpose"] = "platform_commission",
                                ["nigamId"] = req.NigamId.ToString() ?? "",
                            },
                        });
                    }
                }
            }

            // ── TEST MODE: return synthetic order, no real Razorpay call ────
            if (testMode)
            {
                var testOrderId = $"{TestOrderPrefix}{DateTime.UtcNow:yyyyMMddHHmmss}_{Guid.NewGuid():N}";
                _log.LogInformation("[TEST MODE] Synthetic order: {OrderId}", testOrderId);
                return new JsonResult(new
                {
                    orderId  = testOrderId,
                    keyId    = "rzp_test_mode",
                    amount   = amountPaise,
                    currency,
                    petName  = req.PetName ?? "",
                    purpose  = req.Purpose,
                    nigamId  = req.NigamId,
                    testMode = true,
                    transfers = transfers?.Select(t => new {
                        account = t.Account, amount = t.Amount, currency = t.Currency
                    }).ToArray(),
                    platformCut = platformCutPaise,
                    nigamLinkedAccountId,
                });
            }

            // ── PRODUCTION MODE: call real Razorpay API ──────────────────────
            try
            {
                var (keyId, keySecret) = ResolveRazorpayCredentials(req.Purpose);

                var client    = _http.CreateClient();
                var authBytes = Encoding.ASCII.GetBytes($"{keyId}:{keySecret}");
                client.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue(
                        "Basic", Convert.ToBase64String(authBytes));

                var orderPayload = transfers is { Count: > 0 }
                    ? (object)new
                    {
                        amount    = amountPaise,
                        currency,
                        receipt   = $"afp_{req.Purpose}_{DateTime.UtcNow:yyyyMMddHHmmss}",
                        notes     = new { petName = req.PetName ?? "", purpose = req.Purpose, nigamId = req.NigamId },
                        transfers = transfers.Select(t => new
                        {
                            account  = t.Account,
                            amount   = t.Amount,
                            currency = t.Currency,
                            notes    = t.Notes,
                            on_hold  = 0,
                        }).ToArray(),
                    }
                    : new
                    {
                        amount  = amountPaise,
                        currency,
                        receipt = $"afp_{req.Purpose}_{DateTime.UtcNow:yyyyMMddHHmmss}",
                        notes   = new { petName = req.PetName ?? "", purpose = req.Purpose, nigamId = req.NigamId },
                    };

                var response = await client.PostAsJsonAsync("https://api.razorpay.com/v1/orders", orderPayload);
                if (!response.IsSuccessStatusCode)
                {
                    var err = await response.Content.ReadAsStringAsync();
                    _log.LogError("Razorpay order creation failed: {Error}", err);
                    return StatusCode(502, new { error = "Payment gateway error. Please try again." });
                }

                var body = await response.Content.ReadFromJsonAsync<JsonElement>();
                return new JsonResult(new
                {
                    orderId  = body.GetProperty("id").GetString(),
                    keyId,
                    amount   = amountPaise,
                    currency,
                    petName  = req.PetName ?? "",
                    purpose  = req.Purpose,
                    nigamId  = req.NigamId,
                    testMode = false,
                    transfers = transfers?.Select(t => new {
                        account = t.Account, amount = t.Amount, currency = t.Currency
                    }).ToArray(),
                    platformCut = platformCutPaise,
                    nigamLinkedAccountId,
                });
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "CreateOrder failed");
                return StatusCode(500, new { error = "Could not initiate payment. Please try again." });
            }
        }

        // Picks the Razorpay merchant credentials for a given purpose. New
        // deployments should populate Razorpay:Municipal:* and Razorpay:Platform:*
        // separately so pet fees land in the Nigam account and directory fees
        // land in the AFP account. Falls back to the legacy Razorpay:KeyId /
        // KeySecret pair for backward compatibility with existing deployments.
        internal virtual (string keyId, string keySecret) ResolveRazorpayCredentials(string? purpose)
        {
            var scope = IsPlatformPurpose(purpose) ? "Platform" : "Municipal";
            var keyId     = _cfg[$"Razorpay:{scope}:KeyId"]
                            ?? _cfg["Razorpay:KeyId"]
                            ?? throw new InvalidOperationException(
                                $"Razorpay:{scope}:KeyId (or Razorpay:KeyId fallback) not configured.");
            var keySecret = ResolveRazorpayKeySecret(purpose);
            return (keyId, keySecret);
        }

        // Verify only needs the secret, so expose it separately to avoid
        // failing when only Razorpay:KeySecret is present (unit-test config).
        internal virtual string ResolveRazorpayKeySecret(string? purpose)
        {
            var scope = IsPlatformPurpose(purpose) ? "Platform" : "Municipal";
            return _cfg[$"Razorpay:{scope}:KeySecret"]
                   ?? _cfg["Razorpay:KeySecret"]
                   ?? throw new InvalidOperationException(
                       $"Razorpay:{scope}:KeySecret (or Razorpay:KeySecret fallback) not configured.");
        }

        // Looks up the Razorpay linked-account id for a Nigam from the
        // api-proxy. Returns null when the Nigam has not yet completed
        // Route KYC (in which case CreateOrder falls back to a plain,
        // single-account order). Made internal + virtual so unit tests
        // can stub the network hop.
        internal virtual async Task<string?> ResolveNigamLinkedAccountAsync(int nigamId)
        {
            try
            {
                var client = _http.CreateClient("api-proxy");
                var resp   = await client.GetAsync($"/api/geo/nigams/{nigamId}");
                if (!resp.IsSuccessStatusCode) return null;
                var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
                if (json.TryGetProperty("razorpay_account_id", out var el)
                    && el.ValueKind == JsonValueKind.String)
                {
                    var id = el.GetString();
                    return string.IsNullOrWhiteSpace(id) ? null : id;
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Nigam linked-account lookup failed for nigamId={NigamId}", nigamId);
            }
            return null;
        }

        // Resolves a portal-level fee (doctor / shop) in rupees.
        //   1. platform_fees row via /api/platform-fees/resolve
        //   2. appsettings.json override (Payment:DoctorRegistrationFee, etc.)
        //   3. Hard-coded constant
        internal virtual async Task<int> ResolvePlatformFeeAsync(string purpose)
        {
            int fallback = (purpose ?? "").ToLowerInvariant() switch
            {
                "doctor_registration" => _cfg.GetValue<int>("Payment:DoctorRegistrationFee", FeeDoctorRegistration),
                "doctor_renewal"      => _cfg.GetValue<int>("Payment:DoctorRenewalFee",      FeeDoctorRenewal),
                "shop_registration"   => _cfg.GetValue<int>("Payment:ShopRegistrationFee",   FeeShopRegistration),
                "shop_renewal"        => _cfg.GetValue<int>("Payment:ShopRenewalFee",        FeeShopRenewal),
                _                     => FeeDoctorRegistration,
            };
            try
            {
                var client = _http.CreateClient("api-proxy");
                var resp   = await client.GetAsync(
                    $"/api/platform-fees/resolve?feeType={Uri.EscapeDataString(purpose ?? "")}");
                if (resp.IsSuccessStatusCode)
                {
                    var j = await resp.Content.ReadFromJsonAsync<JsonElement>();
                    if (j.TryGetProperty("amount", out var amtEl))
                    {
                        if (amtEl.ValueKind == JsonValueKind.Number && amtEl.TryGetDecimal(out var d))
                            return (int)Math.Round(d);
                        if (amtEl.ValueKind == JsonValueKind.String && decimal.TryParse(amtEl.GetString(), out var s))
                            return (int)Math.Round(s);
                    }
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Platform fee lookup failed for purpose={Purpose}; using fallback {Rupees}", purpose, fallback);
            }
            return fallback;
        }

        // Resolves the fee in rupees for a given purpose, honouring the
        // 4-tier chain (rule → nigam flat → appsettings → constant). Made
        // internal + virtual so unit tests can override the network hop.
        internal virtual async Task<int> ResolveFeeAsync(string purpose, int? nigamId, string? species = null, string? breed = null)
        {
            int fallback = purpose switch
            {
                "renewal"  => _cfg.GetValue<int>("Payment:RenewalFee",      FeeRenewal),
                "transfer" => _cfg.GetValue<int>("Payment:TransferFee",     FeeTransfer),
                _          => _cfg.GetValue<int>("Payment:RegistrationFee", FeeRegistration),
            };
            if (nigamId is null or <= 0) return fallback;

            try
            {
                var client = _http.CreateClient("api-proxy");

                // ── Tier 1: try the per-species/size rule via /resolve-fee ─
                // The Node endpoint classifies (species,breed) → (bucket,size),
                // then looks up the matching nigam_fee_rules row and, if
                // absent, returns the nigam flat fee. So a single call gives
                // us tiers 1 + 2 together and tells us which one won.
                if (!string.IsNullOrWhiteSpace(species))
                {
                    var q = new List<string> { $"purpose={Uri.EscapeDataString(purpose ?? "registration")}",
                                                $"species={Uri.EscapeDataString(species)}" };
                    if (!string.IsNullOrWhiteSpace(breed))
                        q.Add($"breed={Uri.EscapeDataString(breed)}");
                    var resolveResp = await client.GetAsync($"/api/geo/nigams/{nigamId}/resolve-fee?{string.Join("&", q)}");
                    if (resolveResp.IsSuccessStatusCode)
                    {
                        var rj = await resolveResp.Content.ReadFromJsonAsync<JsonElement>();
                        if (rj.TryGetProperty("amount", out var amtEl))
                        {
                            if (amtEl.ValueKind == JsonValueKind.Number && amtEl.TryGetDecimal(out var d))
                                return (int)Math.Round(d);
                            if (amtEl.ValueKind == JsonValueKind.String && decimal.TryParse(amtEl.GetString(), out var s))
                                return (int)Math.Round(s);
                        }
                    }
                }

                // ── Tier 2 fallback: legacy nigam flat fee (when species is
                //    unknown, e.g. renewal/transfer flows that don't need a
                //    breed lookup).
                var resp = await client.GetAsync($"/api/geo/nigams/{nigamId}");
                if (!resp.IsSuccessStatusCode) return fallback;
                var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
                string field = purpose switch
                {
                    "renewal"  => "renewal_fee",
                    "transfer" => "transfer_fee",
                    _          => "registration_fee",
                };
                if (json.TryGetProperty(field, out var feeEl))
                {
                    // The value may come back as a JSON number (from Node) or as
                    // a string (some DB drivers stringify DECIMAL); handle both.
                    if (feeEl.ValueKind == JsonValueKind.Number && feeEl.TryGetDecimal(out var d))
                        return (int)Math.Round(d);
                    if (feeEl.ValueKind == JsonValueKind.String
                        && decimal.TryParse(feeEl.GetString(), out var s))
                        return (int)Math.Round(s);
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Per-nigam fee lookup failed for nigamId={NigamId}; using fallback {Rupees}", nigamId, fallback);
            }
            return fallback;
        }

        // POST /api/payment?handler=Verify
        public IActionResult OnPostVerify([FromBody] VerifyRequest req)
        {
            try
            {
                // Auto-approve synthetic test orders
                if (!string.IsNullOrEmpty(req.OrderId) && req.OrderId.StartsWith(TestOrderPrefix))
                {
                    var testTxn = $"TEST-PAY-{DateTime.UtcNow:yyyyMMddHHmmss}";
                    _log.LogInformation("[TEST MODE] Auto-approved: {OrderId}", req.OrderId);
                    return new JsonResult(new
                    {
                        verified  = true,
                        txnRef    = testTxn,
                        paymentId = testTxn,
                        orderId   = req.OrderId,
                        testMode  = true
                    });
                }

                // Real Razorpay HMAC-SHA256 verification
                var keySecret = ResolveRazorpayKeySecret(req.Purpose);

                var message  = $"{req.OrderId}|{req.PaymentId}";
                var keyBytes = Encoding.UTF8.GetBytes(keySecret);
                var msgBytes = Encoding.UTF8.GetBytes(message);

                using var hmac    = new HMACSHA256(keyBytes);
                var computed      = Convert.ToHexString(hmac.ComputeHash(msgBytes)).ToLowerInvariant();

                if (!CryptographicEquals(computed, req.Signature ?? ""))
                {
                    _log.LogWarning("Payment signature mismatch. OrderId={OrderId}", req.OrderId);
                    return new JsonResult(new { verified = false, error = "Payment verification failed." })
                    { StatusCode = 400 };
                }

                var txnRef = $"RZP-{req.PaymentId}";
                _log.LogInformation("Payment verified. OrderId={OrderId} PaymentId={PaymentId}", req.OrderId, req.PaymentId);
                return new JsonResult(new { verified = true, txnRef, paymentId = req.PaymentId, orderId = req.OrderId, testMode = false });
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Verify failed");
                return StatusCode(500, new { error = "Verification error." });
            }
        }

        private static bool CryptographicEquals(string a, string b)
        {
            if (a.Length != b.Length) return false;
            var diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }

    public class CreateOrderRequest
    {
        public string  Purpose { get; set; } = "registration";
        public string? PetName { get; set; }
        // Optional — when supplied, the server looks up per-nigam fees and
        // uses those. When null/missing we fall back to appsettings + defaults.
        public int?    NigamId { get; set; }
        // Species + Breed drive the per-species/size fee rule lookup. When
        // omitted the server falls back to the nigam's flat fee.
        public string? Species { get; set; }
        public string? Breed   { get; set; }
    }

    public class VerifyRequest
    {
        public string OrderId   { get; set; } = "";
        public string PaymentId { get; set; } = "";
        public string? Signature { get; set; }
        // Same purpose value the client sent to CreateOrder. Used to pick the
        // right Razorpay account for signature verification (Municipal vs
        // Platform). Optional for backward compatibility — missing purpose
        // falls back to the legacy single-account credentials.
        public string? Purpose  { get; set; }
    }

    // Internal DTO for the Razorpay Route transfers[] entry.
    internal sealed class TransferSpec
    {
        public string Account  { get; set; } = "";
        public int    Amount   { get; set; }
        public string Currency { get; set; } = "INR";
        public Dictionary<string, string>? Notes { get; set; }
    }
}

