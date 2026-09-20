using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Net;
using System.Text.Json;

namespace AFP.Pages
{
    /// <summary>
    /// Server-side proxy for shop / doctor ratings given by pet owners.
    /// Each pet owner may submit exactly one rating per target — the
    /// backend performs an UPSERT keyed on (user_id, target_id) so the
    /// latest submission overwrites any previous value. There is no
    /// prior-interaction requirement (per product decision).
    ///
    /// Endpoints:
    ///   POST /api/ratings?handler=Shop      → upsert a shop rating
    ///   POST /api/ratings?handler=Doctor    → upsert a doctor rating
    ///   GET  /api/ratings?handler=ShopSummary&amp;id=42     → { average, count, myRating }
    ///   GET  /api/ratings?handler=DoctorSummary&amp;id=42   → { average, count, myRating }
    ///
    /// This class is a thin façade: persistence lives in the Node backend
    /// behind the "api-proxy" HttpClient, mirroring how Shops/Vets pages
    /// already talk to that service.
    /// </summary>
    [IgnoreAntiforgeryToken]
    public class RatingsModel : PageModel
    {
        public const int MinStars = 1;
        public const int MaxStars = 5;
        public const int MaxCommentLength = 500;

        private readonly IHttpClientFactory _http;
        private readonly ILogger<RatingsModel> _log;

        public RatingsModel(IHttpClientFactory http, ILogger<RatingsModel> log)
        {
            _http = http;
            _log  = log;
        }

        public void OnGet() { }

        // POST /api/ratings?handler=Shop
        public Task<IActionResult> OnPostShopAsync([FromBody] RatingRequest req)
            => UpsertAsync(req, "/api/shop-ratings", "shopId");

        // POST /api/ratings?handler=Doctor
        public Task<IActionResult> OnPostDoctorAsync([FromBody] RatingRequest req)
            => UpsertAsync(req, "/api/doctor-ratings", "doctorId");

        // GET /api/ratings?handler=ShopSummary&id=42
        public Task<IActionResult> OnGetShopSummaryAsync(int id)
            => GetSummaryAsync(id, "/api/shop-ratings");

        // GET /api/ratings?handler=DoctorSummary&id=42
        public Task<IActionResult> OnGetDoctorSummaryAsync(int id)
            => GetSummaryAsync(id, "/api/doctor-ratings");

        internal virtual async Task<IActionResult> UpsertAsync(RatingRequest req, string basePath, string targetIdField)
        {
            if (req is null || req.TargetId <= 0)
                return BadRequest(new { error = "targetId is required." });
            if (req.Stars < MinStars || req.Stars > MaxStars)
                return BadRequest(new { error = $"stars must be between {MinStars} and {MaxStars}." });
            var comment = (req.Comment ?? "").Trim();
            if (comment.Length > MaxCommentLength)
                comment = comment[..MaxCommentLength];

            try
            {
                var client  = _http.CreateClient("api-proxy");
                var payload = new Dictionary<string, object?>
                {
                    [targetIdField] = req.TargetId,
                    ["stars"]       = req.Stars,
                    ["comment"]     = comment,
                };
                var resp = await client.PostAsJsonAsync(basePath, payload);
                if (!resp.IsSuccessStatusCode)
                {
                    var err = await resp.Content.ReadAsStringAsync();
                    _log.LogWarning("Rating upsert failed: {Status} {Body}", (int)resp.StatusCode, err);
                    return StatusCode((int)resp.StatusCode, new { error = "Could not save rating." });
                }
                var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
                return new JsonResult(body);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Rating upsert error for {Path}", basePath);
                return StatusCode(502, new { error = "Rating service unavailable." });
            }
        }

        internal virtual async Task<IActionResult> GetSummaryAsync(int id, string basePath)
        {
            if (id <= 0) return BadRequest(new { error = "id is required." });
            try
            {
                var client = _http.CreateClient("api-proxy");
                var resp   = await client.GetAsync($"{basePath}/{id}/summary");
                if (resp.StatusCode == HttpStatusCode.NotFound)
                    return new JsonResult(new { average = 0.0, count = 0, myRating = (object?)null });
                if (!resp.IsSuccessStatusCode)
                {
                    _log.LogWarning("Rating summary failed: {Status}", (int)resp.StatusCode);
                    return new JsonResult(new { average = 0.0, count = 0, myRating = (object?)null });
                }
                var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
                return new JsonResult(body);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Rating summary error for {Path}/{Id}", basePath, id);
                // Never break page render on a summary hiccup — return zeros.
                return new JsonResult(new { average = 0.0, count = 0, myRating = (object?)null });
            }
        }
    }

    public class RatingRequest
    {
        // Shop id (for shop handler) or doctor id (for doctor handler).
        public int     TargetId { get; set; }
        public int     Stars    { get; set; }
        public string? Comment  { get; set; }
    }
}
