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

    public async Task OnGetAsync(string? city)
    {
        CitySlug = (city ?? "").Trim().ToLowerInvariant();
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

            var url = cityId is null ? "/api/shops" : $"/api/shops?cityId={cityId}";
            var json = await client.GetStringAsync(url);
            Shops = JsonSerializer.Deserialize<List<Shop>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
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
}
