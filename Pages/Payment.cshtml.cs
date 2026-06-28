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

            int amountPaise = req.Purpose switch
            {
                "renewal"  => _cfg.GetValue<int>("Payment:RenewalFee",      FeeRenewal)      * 100,
                "transfer" => _cfg.GetValue<int>("Payment:TransferFee",     FeeTransfer)     * 100,
                _          => _cfg.GetValue<int>("Payment:RegistrationFee", FeeRegistration) * 100,
            };
            string currency = _cfg["Payment:Currency"] ?? Currency;

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
                    notes    = new { petName = req.PetName ?? "", purpose = req.Purpose }
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
                    testMode = false
                });
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "CreateOrder failed");
                return StatusCode(500, new { error = "Could not initiate payment. Please try again." });
            }
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
    }

    public class VerifyRequest
    {
        public string OrderId   { get; set; } = "";
        public string PaymentId { get; set; } = "";
        public string? Signature { get; set; }
    }
}

