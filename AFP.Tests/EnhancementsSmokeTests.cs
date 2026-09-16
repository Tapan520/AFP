using System.IO;
using System.Text;
using AFP.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using QRCoder;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AFP.Tests;

/// <summary>
/// Unit tests for the five enhancements added in the latest batch:
///   1. Pet-licence PDF generation via QuestPDF (+ QR embed via QRCoder)
///   2. Public pet-profile deep-link route existence (Node backend, static grep)
///   3. Hindi / English i18n dictionary sanity
///   4. Analytics endpoint & Overview-tab wiring (static grep of client & server)
///   5. Capacitor mobile-wrapper config
/// </summary>
public sealed class EnhancementsSmokeTests
{
    // ?? Repo root (…\bin\Debug\net8.0 ? …\ ) ????????????????????????????????
    private static readonly string RepoRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    // ?? #1 Pet-licence PDF generation ??????????????????????????????????????
    [Fact]
    public void QuestPdf_GeneratesValidPdfBytes_WithEmbeddedQrCode()
    {
        QuestPDF.Settings.License = LicenseType.Community;

        byte[] qrPng;
        using (var gen = new QRCodeGenerator())
        using (var qrData = gen.CreateQrCode("https://example.test/PetProfile?id=AFP-JA-0001",
                                             QRCodeGenerator.ECCLevel.Q))
        using (var pngQr = new PngByteQRCode(qrData))
        {
            qrPng = pngQr.GetGraphic(10);
        }
        Assert.NotEmpty(qrPng);

        var pdf = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2, Unit.Centimetre);
                page.Content().Column(col =>
                {
                    col.Item().Text("All For Pets — Licence Certificate (test)");
                    col.Item().Image(qrPng);
                });
            });
        }).GeneratePdf();

        Assert.NotNull(pdf);
        Assert.True(pdf.Length > 500, "PDF bytes should be non-trivial");
        // Every well-formed PDF starts with "%PDF-".
        Assert.Equal((byte)'%', pdf[0]);
        Assert.Equal((byte)'P', pdf[1]);
        Assert.Equal((byte)'D', pdf[2]);
        Assert.Equal((byte)'F', pdf[3]);
    }

    [Fact]
    public void PetCertificatePage_IsPresentAndUsesQuestPdfAndQrCoder()
    {
        var cs = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "PetCertificate.cshtml.cs"));
        Assert.Contains("QuestPDF.Fluent",   cs);
        Assert.Contains("QRCodeGenerator",   cs);
        Assert.Contains("application/pdf",   cs);
        Assert.Contains("/api/pets/public/", cs);
    }

    // ?? #2 QR deep-link + public route ?????????????????????????????????????
    [Fact]
    public void NodeBackend_ExposesPublicPetProfileRoute()
    {
        var petsJs = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "pets.js"));
        Assert.Contains("/public/:petId",       petsJs);
        Assert.Contains("registration_status = 'approved'", petsJs);
        // Ensure sensitive fields are NOT leaked by the public route projection
        var publicRouteBody = petsJs.Substring(petsJs.IndexOf("/public/:petId"));
        publicRouteBody     = publicRouteBody.Substring(0, publicRouteBody.IndexOf("router.", 20));
        Assert.DoesNotContain("owner_mobile", publicRouteBody);
        Assert.DoesNotContain("owner_email",  publicRouteBody);
    }

    [Fact]
    public void PetProfilePage_ExistsAndCallsPublicApi()
    {
        var cs = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "PetProfile.cshtml.cs"));
        Assert.Contains("/api/pets/public/", cs);
        Assert.Contains("PublicPet",         cs);
    }

    [Fact]
    public void QrModal_EncodesRealDeepLinkUrl_NotFakeGrid()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-pets.js"));
        Assert.Contains("openQRModal",       js);
        Assert.Contains("/PetProfile?id=",   js);
        Assert.Contains("Download Licence PDF", js);
        // Old placeholder grid renderer must be gone
        Assert.DoesNotContain("qr-cell\" style=\"background:${on", js);
    }

    // ?? #3 Multi-language (EN / HI) ????????????????????????????????????????
    [Fact]
    public void I18nModule_ExistsWithEnglishAndHindiDictionaries()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-i18n.js"));
        Assert.Contains("en:", js);
        Assert.Contains("hi:", js);
        Assert.Contains("setLang", js);
        Assert.Contains("localStorage",  js);
        Assert.Contains("afp_lang",      js);
        // Sanity: at least a few known keys present in both languages
        foreach (var key in new[] { "btn.login", "btn.logout", "nav.home", "pet.qrTitle" })
        {
            Assert.Contains("\"" + key + "\"", js);
        }
        // Hindi Devanagari present — stored as \uXXXX escapes so the file
        // stays pure ASCII on disk. Verify escape sequences fall in the
        // Devanagari range (U+0900–U+097F) at least a few times.
        var devanagariEscapes = System.Text.RegularExpressions.Regex.Matches(
            js, @"\\u09[0-7][0-9A-Fa-f]");
        Assert.True(devanagariEscapes.Count > 20,
            $"Expected many Devanagari \\uXXXX escapes; found {devanagariEscapes.Count}");
    }

    [Fact]
    public void AppLayout_LoadsI18nBeforeCore()
    {
        var razor = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "Shared", "_AppLayout.cshtml"));
        var i18nIdx = razor.IndexOf("afp-i18n.js", StringComparison.Ordinal);
        var coreIdx = razor.IndexOf("afp-core.js", StringComparison.Ordinal);
        Assert.True(i18nIdx > 0, "afp-i18n.js must be referenced by the layout");
        Assert.True(coreIdx > 0, "afp-core.js must be referenced by the layout");
        Assert.True(i18nIdx < coreIdx, "i18n must be loaded before core so I18n.t is available");
    }

    // ?? #4 Analytics dashboard ?????????????????????????????????????????????
    [Fact]
    public void AnalyticsRoute_ExistsAndMountedInServer()
    {
        var analytics = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "adminAnalytics.js"));
        Assert.Contains("cityTrends",     analytics);
        Assert.Contains("yoyRevenue",     analytics);
        Assert.Contains("speciesMix",     analytics);
        Assert.Contains("pendingByWard",  analytics);
        Assert.Contains("requireRole",    analytics);

        var server = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "server.js"));
        Assert.Contains("adminAnalyticsRouter",       server);
        Assert.Contains("/api/admin/analytics",       server);
    }

    [Fact]
    public void AdminOverview_RendersAnalyticsWithChartJs()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-admin.js"));
        Assert.Contains("renderAnalyticsDashboard", js);
        Assert.Contains("admin-analytics",          js);
        Assert.Contains("chart.js",                 js);
        Assert.Contains("chart-yoy",                js);
        Assert.Contains("chart-city",               js);
        Assert.Contains("chart-species",            js);
    }

    // ?? #5 Capacitor wrapper ???????????????????????????????????????????????
    [Fact]
    public void CapacitorConfig_IsValidJsonWithExpectedFields()
    {
        var path = Path.Combine(RepoRoot, "capacitor.config.json");
        Assert.True(File.Exists(path), "capacitor.config.json must exist");
        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        Assert.Equal("com.allforpets.municipal", root.GetProperty("appId").GetString());
        Assert.Equal("All For Pets",             root.GetProperty("appName").GetString());
        Assert.Equal("wwwroot",                  root.GetProperty("webDir").GetString());
        Assert.True(root.TryGetProperty("server", out _));
    }

    [Fact]
    public void PackageJson_DeclaresCapacitorDependenciesAndScripts()
    {
        var path = Path.Combine(RepoRoot, "package.json");
        Assert.True(File.Exists(path), "package.json must exist");
        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        var deps = root.GetProperty("dependencies");
        Assert.True(deps.TryGetProperty("@capacitor/core", out _));
        Assert.True(deps.TryGetProperty("@capacitor/android", out _));
        Assert.True(deps.TryGetProperty("@capacitor/ios", out _));
        var scripts = root.GetProperty("scripts");
        Assert.True(scripts.TryGetProperty("cap:sync", out _));
        Assert.True(scripts.TryGetProperty("cap:add:android", out _));
    }

    // ?? Bonus: CdnUrlResolver still works after this batch ?????????????????
    [Fact]
    public void CdnUrlResolver_ReturnsCdnUrl_WhenBaseUrlConfigured()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cdn:BaseUrl"] = "https://cdn.example.test",
            }).Build();
        var env = new StubEnv();
        var r   = new CdnUrlResolver(env, cfg);
        Assert.True(r.CdnEnabled);
        var url = r.Resolve("js/afp-i18n.js");
        Assert.StartsWith("https://cdn.example.test/js/afp-i18n.js", url);
    }

    [Fact]
    public void CdnUrlResolver_ReturnsLocalUrl_WhenBaseUrlEmpty()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Cdn:BaseUrl"] = "" })
            .Build();
        var r = new CdnUrlResolver(new StubEnv(), cfg);
        Assert.False(r.CdnEnabled);
        Assert.StartsWith("/js/afp-core.js", r.Resolve("js/afp-core.js"));
    }

    // A minimal IWebHostEnvironment stub so CdnUrlResolver's FileProvider lookup
    // never explodes even though our tests never touch a real wwwroot.
    private sealed class StubEnv : IWebHostEnvironment
    {
        public string     WebRootPath      { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string     ApplicationName  { get; set; } = "AFP.Tests";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string     ContentRootPath  { get; set; } = "";
        public string     EnvironmentName  { get; set; } = "Test";
    }
}
