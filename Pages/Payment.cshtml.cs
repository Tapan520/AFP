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
    /// </summary>
    [IgnoreAntiforgeryToken]
    public class PaymentModel : PageModel
    {
        public const int FeeRegistration = 200;
        public const int FeeRenewal      = 150;
        public const int FeeTransfer     = 100;
        public const string Currency     = "INR";

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

            // Fee resolution — four-tier fallback:
            //   1. Per-nigam per-species/size RULE from nigam_fee_rules
            //      (uses `species` + `breed` on the request to classify the pet)
            //   2. Per-nigam FLAT fee on the nigams row
            //   3. appsettings.json override (Payment:RegistrationFee, etc.)
            //   4. Hard-coded constants (FeeRegistration / FeeRenewal / FeeTransfer)
            // This lets each municipal corporation set a fine-grained tariff
            // (Dog-Large vs Dog-Small vs Cat vs Other) while still guaranteeing
            // a working default for solo dev / demos.
            int amountRupees = await ResolveFeeAsync(req.Purpose, req.NigamId, req.Species, req.Breed);
            int amountPaise  = amountRupees * 100;
            string currency  = _cfg["Payment:Currency"] ?? Currency;

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
                    testMode = true
                });
            }

            // ── PRODUCTION MODE: call real Razorpay API ──────────────────────
            try
            {
                var keyId     = _cfg["Razorpay:KeyId"]
                    ?? throw new InvalidOperationException("Razorpay:KeyId not configured.");
                var keySecret = _cfg["Razorpay:KeySecret"]
                    ?? throw new InvalidOperationException("Razorpay:KeySecret not configured.");

                var client    = _http.CreateClient();
                var authBytes = Encoding.ASCII.GetBytes($"{keyId}:{keySecret}");
                client.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue(
                        "Basic", Convert.ToBase64String(authBytes));

                var orderPayload = new
                {
                    amount   = amountPaise,
                    currency,
                    receipt  = $"afp_{req.Purpose}_{DateTime.UtcNow:yyyyMMddHHmmss}",
                    notes    = new { petName = req.PetName ?? "", purpose = req.Purpose, nigamId = req.NigamId }
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
                    testMode = false
                });
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "CreateOrder failed");
                return StatusCode(500, new { error = "Could not initiate payment. Please try again." });
            }
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
                var keySecret = _cfg["Razorpay:KeySecret"]
                    ?? throw new InvalidOperationException("Razorpay:KeySecret not configured.");

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
    }
}

