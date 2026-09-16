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

    public async Task OnGetAsync(string? city)
    {
        CitySlug = (city ?? "").Trim().ToLowerInvariant();
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

            var url = cityId is null ? "/api/doctors" : $"/api/doctors?cityId={cityId}";
            var json = await client.GetStringAsync(url);
            Doctors = JsonSerializer.Deserialize<List<Doctor>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
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
    }
}
