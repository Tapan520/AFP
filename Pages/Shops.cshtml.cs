using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

public class ShopsModel : PageModel
{
    private readonly IHttpClientFactory _factory;
    public ShopsModel(IHttpClientFactory factory) => _factory = factory;

    public string CitySlug { get; private set; } = "";
    public string CityName { get; private set; } = "";
    public List<Shop> Shops { get; private set; } = new();
    public Dictionary<int, List<Review>> ReviewsByShop { get; private set; } = new();

    // Pagination: 10 shops per page.
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

            var offset = (CurrentPage - 1) * PageSize;
            var baseUrl = cityId is null ? "/api/shops?sortBy=rating" : $"/api/shops?cityId={cityId}&sortBy=rating";
            var url = $"{baseUrl}&limit={PageSize}&offset={offset}";
            var json = await client.GetStringAsync(url);
            Shops = JsonSerializer.Deserialize<List<Shop>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
            HasNextPage = Shops.Count >= PageSize;

            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            foreach (var s in Shops.Where(x => (x.RatingCount ?? 0) > 0))
            {
                try
                {
                    var revJson = await client.GetStringAsync($"/api/ratings/for/shop/{s.Id}?limit=3");
                    var payload = JsonSerializer.Deserialize<ReviewsPayload>(revJson, opts);
                    if (payload?.Rows is { Count: > 0 })
                        ReviewsByShop[s.Id] = payload.Rows;
                }
                catch { /* best-effort */ }
            }
        }
        catch { Shops = new(); }
    }

    public sealed class City
    {
        [JsonPropertyName("id")]   public int    Id   { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
    }

    public sealed class Shop
    {
        [JsonPropertyName("id")]         public int    Id         { get; set; }
        [JsonPropertyName("name")]       public string? Name       { get; set; }
        [JsonPropertyName("owner_name")] public string? OwnerName  { get; set; }
        [JsonPropertyName("speciality")] public string? Speciality { get; set; }
        [JsonPropertyName("address")]    public string? Address    { get; set; }
        [JsonPropertyName("mobile")]     public string? Mobile     { get; set; }
        [JsonPropertyName("timings")]    public string? Timings    { get; set; }
        [JsonPropertyName("city_name")]  public string? CityName   { get; set; }
        [JsonPropertyName("average_rating")] public double? AverageRating { get; set; }
        [JsonPropertyName("rating_count")]   public int?    RatingCount   { get; set; }
    }

    public sealed class Review
    {
        [JsonPropertyName("stars")]         public int      Stars        { get; set; }
        [JsonPropertyName("comment")]       public string?  Comment      { get; set; }
        [JsonPropertyName("reviewer_name")] public string?  ReviewerName { get; set; }
        [JsonPropertyName("updated_at")]    public DateTime? UpdatedAt   { get; set; }
    }

    private sealed class ReviewsPayload
    {
        [JsonPropertyName("rows")] public List<Review>? Rows { get; set; }
    }
}
