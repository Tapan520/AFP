using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AFP.Pages;

/// <summary>
/// GET /PetCertificate?id=AFP-JA-0001
///   ? application/pdf  (municipal pet-licence certificate)
///
/// Data is pulled from the public pet endpoint on the Node backend so this
/// page works for any approved pet without requiring an auth cookie.
/// </summary>
public class PetCertificateModel : PageModel
{
    private readonly IHttpClientFactory _factory;

    static PetCertificateModel()
    {
        // QuestPDF Community Licence — free for FOSS, non-commercial, and companies
        // with < $1M annual revenue. See https://www.questpdf.com/license/
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public PetCertificateModel(IHttpClientFactory factory) => _factory = factory;

    public async Task<IActionResult> OnGetAsync(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest("Missing pet id.");

        var client = _factory.CreateClient("api-proxy");
        var resp   = await client.GetAsync($"/api/pets/public/{Uri.EscapeDataString(id)}");
        if (!resp.IsSuccessStatusCode)
            return NotFound("Pet not found or not yet approved.");

        var json = await resp.Content.ReadAsStringAsync();
        var pet  = JsonSerializer.Deserialize<PublicPet>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        if (pet is null) return NotFound();

        // Deep-link URL encoded into the QR
        var scheme = HttpContext.Request.Scheme;
        var host   = HttpContext.Request.Host.Value;
        var qrUrl  = $"{scheme}://{host}/PetProfile?id={Uri.EscapeDataString(pet.PetId ?? "")}";

        byte[] qrPng;
        using (var generator = new QRCodeGenerator())
        using (var data = generator.CreateQrCode(qrUrl, QRCodeGenerator.ECCLevel.Q))
        using (var qr = new PngByteQRCode(data))
        {
            qrPng = qr.GetGraphic(10);
        }

        var pdfBytes = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2, Unit.Centimetre);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(t => t.FontSize(11).FontColor("#1A1814"));

                page.Header().Column(col =>
                {
                    col.Item().AlignCenter().Text("?? ALL FOR PETS").FontSize(20).SemiBold().FontColor("#E8670A");
                    col.Item().AlignCenter().Text("Municipal Pet Registry — Licence Certificate").FontSize(11).FontColor("#5A564F");
                    col.Item().PaddingTop(4).LineHorizontal(1).LineColor("#E8670A");
                });

                page.Content().PaddingVertical(14).Column(col =>
                {
                    col.Spacing(10);

                    col.Item().Background("#FFF3E8").Padding(14).Column(hero =>
                    {
                        hero.Item().Text(t =>
                        {
                            t.Span("Licence No.  ").FontColor("#5A564F");
                            t.Span(pet.PetId ?? "—").SemiBold();
                        });
                        hero.Item().Text(t =>
                        {
                            t.Span("Issued on   ").FontColor("#5A564F");
                            t.Span(DateTime.Today.ToString("dd MMMM yyyy")).SemiBold();
                        });
                        hero.Item().Text(t =>
                        {
                            t.Span("Valid until ").FontColor("#5A564F");
                            t.Span(pet.LicenceExpiryDate?.ToString("dd MMMM yyyy") ?? "—").SemiBold();
                        });
                    });

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(details =>
                        {
                            details.Spacing(5);
                            details.Item().Text("Pet details").SemiBold().FontSize(13);
                            Row(details, "Name",    pet.Name);
                            Row(details, "Species", pet.Species);
                            Row(details, "Breed",   pet.Breed);
                            Row(details, "Colour",  pet.Colour);
                            Row(details, "Gender",  pet.Gender);
                            details.Item().PaddingTop(6).Text("Owner & jurisdiction").SemiBold().FontSize(13);
                            Row(details, "Owner",   pet.OwnerName);
                            Row(details, "Ward",    pet.WardNumber);
                            Row(details, "Nigam",   pet.NigamName);
                            Row(details, "City",    pet.CityName);
                        });
                        row.ConstantItem(140).Column(qrCol =>
                        {
                            qrCol.Item().AlignCenter().Image(qrPng);
                            qrCol.Item().AlignCenter().PaddingTop(4)
                                 .Text("Scan for public profile")
                                 .FontSize(9).FontColor("#5A564F");
                        });
                    });

                    col.Item().PaddingTop(6).Background("#F7F5F2").Padding(10).Text(t =>
                    {
                        t.Span("This certificate is a computer-generated document issued by the municipal pet registry. ").FontSize(9);
                        t.Span("Verify authenticity at ").FontSize(9);
                        t.Span(qrUrl).FontSize(9).Underline().FontColor("#1E6FD9");
                    });
                });

                page.Footer().AlignCenter().Text(t =>
                {
                    t.Span("Generated ").FontSize(9).FontColor("#9A958C");
                    t.Span(DateTime.Now.ToString("dd MMM yyyy HH:mm")).FontSize(9).FontColor("#9A958C");
                    t.Span("  ·  All For Pets © Municipal Portal").FontSize(9).FontColor("#9A958C");
                });
            });
        }).GeneratePdf();

        return File(pdfBytes, "application/pdf", $"AFP-Licence-{pet.PetId}.pdf");
    }

    private static void Row(QuestPDF.Fluent.ColumnDescriptor col, string label, string? value)
    {
        col.Item().Row(r =>
        {
            r.ConstantItem(70).Text(label).FontColor("#5A564F");
            r.RelativeItem().Text(string.IsNullOrWhiteSpace(value) ? "—" : value).SemiBold();
        });
    }

    private sealed class PublicPet
    {
        [JsonPropertyName("pet_id")]              public string?  PetId              { get; set; }
        [JsonPropertyName("name")]                public string?  Name               { get; set; }
        [JsonPropertyName("species")]             public string?  Species            { get; set; }
        [JsonPropertyName("breed")]               public string?  Breed              { get; set; }
        [JsonPropertyName("colour")]              public string?  Colour             { get; set; }
        [JsonPropertyName("gender")]              public string?  Gender             { get; set; }
        [JsonPropertyName("owner_name")]          public string?  OwnerName          { get; set; }
        [JsonPropertyName("city_name")]           public string?  CityName           { get; set; }
        [JsonPropertyName("nigam_name")]          public string?  NigamName          { get; set; }
        [JsonPropertyName("ward_number")]         public string?  WardNumber         { get; set; }
        [JsonPropertyName("licence_expiry_date")] public DateTime? LicenceExpiryDate { get; set; }
    }
}
