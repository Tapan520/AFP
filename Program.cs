var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddRazorPages();
builder.Services.AddSingleton<AFP.Services.CdnUrlResolver>();
builder.Services.AddHttpClient("api-proxy", (sp, client) =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var baseUrl = cfg["ApiProxy:BaseUrl"] ?? "http://localhost:3000";
    client.BaseAddress = new Uri(baseUrl);
    client.Timeout = TimeSpan.FromSeconds(100);
});
builder.Services.AddHttpClient(); // default client for other pages

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();

// ?? CDN-friendly static-file caching ????????????????????????????????????????
// Files under /js, /css and /images are versioned via `asp-append-version`
// so we can safely tell CDNs & browsers to cache them for a year.
// When a Cdn:BaseUrl is configured, `<cdn-static>` (see TagHelper) rewrites
// URLs to point at the CDN edge — but the local /wwwroot files remain the
// canonical origin.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var p = ctx.Context.Request.Path.Value ?? "";
        var isVersioned = p.StartsWith("/js/", StringComparison.OrdinalIgnoreCase)
                       || p.StartsWith("/css/", StringComparison.OrdinalIgnoreCase)
                       || p.StartsWith("/images/", StringComparison.OrdinalIgnoreCase)
                       || p.StartsWith("/lib/", StringComparison.OrdinalIgnoreCase);
        if (isVersioned)
        {
            // 1 year immutable — safe because asp-append-version busts the cache on change.
            ctx.Context.Response.Headers["Cache-Control"] = "public,max-age=31536000,immutable";
        }
        else
        {
            ctx.Context.Response.Headers["Cache-Control"] = "public,max-age=3600";
        }
    }
});

app.UseRouting();
app.UseAuthorization();

// ?? Reverse-proxy /api/* and /uploads/* to the Node backend ?????????????????
// The frontend JS uses relative URLs (see wwwroot/js/afp-core.js) and relies on
// the .NET server to forward those requests to http://localhost:3000 in dev.
app.Map("/api/{**catchall}", ProxyToBackend);
app.Map("/uploads/{**catchall}", ProxyToBackend);

// ── SEO: robots.txt + sitemap.xml ────────────────────────────────────────────
app.MapGet("/robots.txt", (HttpContext ctx) =>
{
    var host = $"{ctx.Request.Scheme}://{ctx.Request.Host}";
    var body = $"User-agent: *\nAllow: /\nDisallow: /Error\nDisallow: /uploads/\nSitemap: {host}/sitemap.xml\n";
    ctx.Response.ContentType = "text/plain; charset=utf-8";
    return ctx.Response.WriteAsync(body);
});

// ── Android App Links verification ───────────────────────────────────────────
// Google's App Link verifier fetches this file to confirm the SHA-256 of the
// APK signing key. When it matches, `intent-filter android:autoVerify="true"`
// in AndroidManifest.xml starts opening https://afp.up.railway.app/* links
// INSIDE the AFP app instead of the browser — which is what QR-scan on a
// physical pet tag should do. Content lives in wwwroot/.well-known/ so any
// change goes through the normal deploy pipeline.
app.MapGet("/.well-known/assetlinks.json", async (HttpContext ctx, IWebHostEnvironment env) =>
{
    var file = Path.Combine(env.WebRootPath, ".well-known", "assetlinks.json");
    if (!File.Exists(file))
    {
        ctx.Response.StatusCode = 404;
        return;
    }
    ctx.Response.ContentType = "application/json; charset=utf-8";
    ctx.Response.Headers["Cache-Control"] = "public,max-age=86400";
    await ctx.Response.SendFileAsync(file);
});

app.MapGet("/sitemap.xml", async (HttpContext ctx, IHttpClientFactory httpFactory) =>
{
    var host  = $"{ctx.Request.Scheme}://{ctx.Request.Host}";
    var urls  = new List<string> { $"{host}/", $"{host}/vets", $"{host}/shops" };

    try
    {
        var client     = httpFactory.CreateClient("api-proxy");
        var citiesJson = await client.GetStringAsync("/api/geo/cities");
        using var doc  = System.Text.Json.JsonDocument.Parse(citiesJson);
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            var name = el.TryGetProperty("name", out var n) ? n.GetString() : null;
            if (string.IsNullOrWhiteSpace(name)) continue;
            var slug = Uri.EscapeDataString(name.ToLowerInvariant());
            urls.Add($"{host}/vets/{slug}");
            urls.Add($"{host}/shops/{slug}");
        }
    }
    catch { /* backend may be down at build/dev; still serve base sitemap */ }

    var sb = new System.Text.StringBuilder();
    sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    sb.Append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    foreach (var u in urls)
    {
        sb.Append("  <url><loc>").Append(System.Net.WebUtility.HtmlEncode(u)).Append("</loc></url>\n");
    }
    sb.Append("</urlset>\n");
    ctx.Response.ContentType = "application/xml; charset=utf-8";
    await ctx.Response.WriteAsync(sb.ToString());
});

app.MapRazorPages();

app.Run();

static async Task ProxyToBackend(HttpContext ctx, IHttpClientFactory httpFactory)
{
    var client = httpFactory.CreateClient("api-proxy");
    var targetUri = new Uri(client.BaseAddress!, ctx.Request.Path + ctx.Request.QueryString);

    using var upstream = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), targetUri);

    // Buffer the request body so the upstream call can read it reliably.
    // Note: DELETE is allowed to carry a JSON body (e.g. bulk-delete audit logs
    // with `{ ids: [...] }`), so we only skip GET/HEAD here.
    if (!HttpMethods.IsGet(ctx.Request.Method) &&
        !HttpMethods.IsHead(ctx.Request.Method))
    {
        using var ms = new MemoryStream();
        await ctx.Request.Body.CopyToAsync(ms, ctx.RequestAborted);
        var bytes = ms.ToArray();
        upstream.Content = new ByteArrayContent(bytes);

        // Set Content-Type from the incoming request (fallback to JSON when unknown).
        var contentType = ctx.Request.ContentType ?? "application/json";
        upstream.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        upstream.Content.Headers.ContentLength = bytes.LongLength;
    }

    // Forward only auth-related / safe headers. Do NOT forward hop-by-hop headers
    // or Content-Type / Content-Length (already set above).
    string[] passthroughHeaders =
    {
        "Authorization",
        "Accept",
        "Accept-Language",
        "User-Agent",
        "X-Forwarded-For",
        "X-Requested-With",
    };
    foreach (var name in passthroughHeaders)
    {
        if (ctx.Request.Headers.TryGetValue(name, out var values))
        {
            upstream.Headers.TryAddWithoutValidation(name, values.ToArray());
        }
    }

    try
    {
        using var response = await client.SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);

        ctx.Response.StatusCode = (int)response.StatusCode;

        foreach (var header in response.Headers)
        {
            if (string.Equals(header.Key, "Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
            ctx.Response.Headers[header.Key] = header.Value.ToArray();
        }
        foreach (var header in response.Content.Headers)
        {
            ctx.Response.Headers[header.Key] = header.Value.ToArray();
        }
        ctx.Response.Headers.Remove("transfer-encoding");

        await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
    }
    catch (HttpRequestException ex)
    {
        ctx.Response.StatusCode = StatusCodes.Status502BadGateway;
        await ctx.Response.WriteAsJsonAsync(new
        {
            error   = "Backend API unreachable. Is the Node.js server running on port 3000?",
            details = ex.Message,
        });
    }
}

