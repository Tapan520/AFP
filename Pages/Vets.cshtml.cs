using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

public class VetsModel : PageModel
{
    private readonly IHttpClientFactory _factory;
    public VetsModel(IHttpClientFactory factory) => _factory = factory;

    public string CitySlug { get; private set; } = "";
    public string CityName { get; private set; } = "";
    public List<Doctor> Doctors { get; private set; } = new();
    // Keyed by doctor id — first N reviews for SEO / inline expansion.
    public Dictionary<int, List<Review>> ReviewsByDoctor { get; private set; } = new();

    // Pagination: 10 vets per page. HasNextPage is set when the backend returns
    // a full page (== PageSize), meaning there may be more rows to fetch.
    public const int PageSize = 10;
    public int  CurrentPage { get; private set; } = 1;
    public bool HasNextPage { get; private set; }

    public async Task OnGetAsync(string? city)
    {
        CitySlug = (city ?? "").Trim().ToLowerInvariant();
        CurrentPage = int.TryParse(Request.Query["page"], out var p) && p > 0 ? p : 1;
        CityName = string.IsNullOrEmpty(CitySlug)
            ? "India"
            : char.ToUpper(CitySlug[0]) + CitySlug[1..];

        try
        {
            var client = _factory.CreateClient("api-proxy");

            // Resolve city name -> id (best effort). Public endpoint, no auth.
            int? cityId = null;
            if (!string.IsNullOrEmpty(CitySlug))
            {
                var citiesJson = await client.GetStringAsync("/api/geo/cities");
                var cities     = JsonSerializer.Deserialize<List<City>>(citiesJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
                var match = cities.FirstOrDefault(c =>
                    string.Equals(c.Name, CitySlug, StringComparison.OrdinalIgnoreCase));
                if (match is not null) { cityId = match.Id; CityName = match.Name ?? CityName; }
            }

            // Default sort = highest-rated first (matches backend default).
            var offset = (CurrentPage - 1) * PageSize;
            var baseUrl = cityId is null ? "/api/doctors?sortBy=rating" : $"/api/doctors?cityId={cityId}&sortBy=rating";
            var url = $"{baseUrl}&limit={PageSize}&offset={offset}";
            var json = await client.GetStringAsync(url);
            Doctors = JsonSerializer.Deserialize<List<Doctor>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
            HasNextPage = Doctors.Count >= PageSize;

            // Best-effort: fetch up to 3 reviews for each rated doctor so the
            // page can render an inline preview and Google can crawl them.
            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            foreach (var d in Doctors.Where(x => (x.RatingCount ?? 0) > 0))
            {
                try
                {
                    var revJson = await client.GetStringAsync($"/api/ratings/for/doctor/{d.Id}?limit=3");
                    var payload = JsonSerializer.Deserialize<ReviewsPayload>(revJson, opts);
                    if (payload?.Rows is { Count: > 0 })
                        ReviewsByDoctor[d.Id] = payload.Rows;
                }
                catch { /* review fetch best-effort — never break the page */ }
            }
        }
        catch { Doctors = new(); }
    }

    public sealed class City
    {
        [JsonPropertyName("id")]   public int    Id   { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
    }

    public sealed class Doctor
    {
        [JsonPropertyName("id")]             public int    Id             { get; set; }
        [JsonPropertyName("name")]           public string? Name           { get; set; }
        [JsonPropertyName("qualification")]  public string? Qualification  { get; set; }
        [JsonPropertyName("specialization")] public string? Specialization { get; set; }
        [JsonPropertyName("clinic_name")]    public string? ClinicName     { get; set; }
        [JsonPropertyName("address")]        public string? Address        { get; set; }
        [JsonPropertyName("mobile")]         public string? Mobile         { get; set; }
        [JsonPropertyName("timings")]        public string? Timings        { get; set; }
        [JsonPropertyName("is_24hr")]        public bool   Is24hr         { get; set; }
        [JsonPropertyName("city_name")]      public string? CityName       { get; set; }
        [JsonPropertyName("average_rating")] public double? AverageRating { get; set; }
        [JsonPropertyName("rating_count")]   public int?    RatingCount   { get; set; }
    }

    public sealed class Review
    {
        [JsonPropertyName("stars")]         public int     Stars         { get; set; }
        [JsonPropertyName("comment")]       public string? Comment       { get; set; }
        [JsonPropertyName("reviewer_name")] public string? ReviewerName  { get; set; }
        [JsonPropertyName("updated_at")]    public DateTime? UpdatedAt   { get; set; }
    }

    private sealed class ReviewsPayload
    {
        [JsonPropertyName("rows")] public List<Review>? Rows { get; set; }
    }
}
