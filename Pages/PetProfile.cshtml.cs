using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

public class PetProfileModel : PageModel
{
    private readonly IHttpClientFactory _factory;
    public PetProfileModel(IHttpClientFactory factory) => _factory = factory;

    public string    PetId    { get; private set; } = "";
    public new bool  NotFound { get; private set; }
    public PublicPet? Pet     { get; private set; }

    public async Task OnGetAsync(string? id)
    {
        PetId = id ?? "";
        if (string.IsNullOrWhiteSpace(id)) { NotFound = true; return; }

        try
        {
            var client = _factory.CreateClient("api-proxy");
            var resp   = await client.GetAsync($"/api/pets/public/{Uri.EscapeDataString(id)}");
            if (!resp.IsSuccessStatusCode) { NotFound = true; return; }
            var json = await resp.Content.ReadAsStringAsync();
            Pet = JsonSerializer.Deserialize<PublicPet>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            if (Pet is null) NotFound = true;
        }
        catch { NotFound = true; }
    }

    public sealed class PublicPet
    {
        [JsonPropertyName("pet_id")]              public string?  PetId              { get; set; }
        [JsonPropertyName("name")]                public string?  Name               { get; set; }
        [JsonPropertyName("species")]             public string?  Species            { get; set; }
        [JsonPropertyName("breed")]               public string?  Breed              { get; set; }
        [JsonPropertyName("colour")]              public string?  Colour             { get; set; }
        [JsonPropertyName("gender")]              public string?  Gender             { get; set; }
        [JsonPropertyName("photo_url")]           public string?  PhotoUrl           { get; set; }
        [JsonPropertyName("owner_name")]          public string?  OwnerName          { get; set; }
        [JsonPropertyName("city_name")]           public string?  CityName           { get; set; }
        [JsonPropertyName("nigam_name")]          public string?  NigamName          { get; set; }
        [JsonPropertyName("ward_number")]         public string?  WardNumber         { get; set; }
        [JsonPropertyName("licence_expiry_date")] public DateTime? LicenceExpiryDate { get; set; }
        [JsonPropertyName("licence_status")]      public string?  LicenceStatus      { get; set; }
    }
}
