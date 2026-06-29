var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT at runtime — bind to it so the service is reachable
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddRazorPages();
builder.Services.AddHttpClient();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

// Note: HTTPS redirection is intentionally omitted — Railway terminates TLS
// at the edge proxy, so enforcing it inside the container causes redirect loops.
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();
app.MapRazorPages();

// ?? Proxy base URL ????????????????????????????????????????????????????????????
// Dev  ? local Node/Express on port 3000
// Prod ? Railway backend (override with BACKEND_URL env var on Railway)
var backendBase = Environment.GetEnvironmentVariable("BACKEND_URL")
    ?? (app.Environment.IsDevelopment()
        ? "http://localhost:3000"
        : "https://web-production-06875.up.railway.app");

// ?? Shared proxy helpers ??????????????????????????????????????????????????????
static HttpClient MakeClient(IHttpClientFactory f, HttpRequest req)
{
    var c    = f.CreateClient();
    var auth = req.Headers["Authorization"].FirstOrDefault();
    if (!string.IsNullOrEmpty(auth))
        c.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", auth);
    return c;
}

// Safely forward a GET response, returning a 502 JSON error if Node is down.
static async Task<IResult> SafeGet(HttpResponseMessage resp, string fallback = "")
{
    var body = await resp.Content.ReadAsStringAsync();
    return Results.Content(
        body.Length > 0 ? body : (fallback.Length > 0 ? fallback : "{}"),
        "application/json",
        statusCode: (int)resp.StatusCode);
}

// ?? Auth proxy ????????????????????????????????????????????????????????????????
// POST /api/auth/login   POST /api/auth/register
app.MapPost("/api/auth/{action}", async (string action, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync(
            $"{backendBase}/api/auth/{action}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Geo proxy ?????????????????????????????????????????????????????????????????
// GET /api/geo/cities  GET /api/geo/nigams  GET /api/geo/wards
// GET /api/geo/cities/all  GET /api/geo/nigams/all  GET /api/geo/wards/all
app.MapGet("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs      = ctx.Request.QueryString.Value ?? "";
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var resp    = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/geo{segment}{qs}");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/geo{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/geo{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Pets proxy ????????????????????????????????????????????????????????????????
app.MapGet("/api/pets/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs      = ctx.Request.QueryString.Value ?? "";
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var resp    = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/pets{segment}{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
// ?? Upload proxy — raw stream passthrough (MUST be before generic POST catch-all) ??????????
// The generic POST proxy reads the body as UTF-8 text and re-wraps it as application/json,
// which destroys multipart/form-data boundaries. These specific routes stream raw bytes through.
app.MapPost("/api/pets/{id:int}/upload-photo", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var client  = MakeClient(f, ctx.Request);
        var content = new StreamContent(ctx.Request.Body);
        if (!string.IsNullOrEmpty(ctx.Request.ContentType))
            content.Headers.TryAddWithoutValidation("Content-Type", ctx.Request.ContentType);
        var resp = await client.PostAsync($"{backendBase}/api/pets/{id}/upload-photo", content);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/pets/{id:int}/upload-certificate", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var client  = MakeClient(f, ctx.Request);
        var content = new StreamContent(ctx.Request.Body);
        if (!string.IsNullOrEmpty(ctx.Request.ContentType))
            content.Headers.TryAddWithoutValidation("Content-Type", ctx.Request.ContentType);
        var resp = await client.PostAsync($"{backendBase}/api/pets/{id}/upload-certificate", content);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/pets/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/pets{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapMethods("/api/pets/{**path}", new[] { "PATCH" }, async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment  = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json     = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var patchReq = new HttpRequestMessage(new HttpMethod("PATCH"), $"{backendBase}/api/pets{segment}")
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
        var resp = await MakeClient(f, ctx.Request).SendAsync(patchReq);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Doctors proxy (public GET + admin write) ??????????????????????????????????
// GET /api/doctors  — used by citizen search screen (AFP.GET)
app.MapGet("/api/doctors", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/doctors{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// GET /api/admin/doctors  — used by DoctorMgmt module
app.MapGet("/api/admin/doctors", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/doctors{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/admin/doctors", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/doctors",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/admin/doctors/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/doctors/{id}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapDelete("/api/admin/doctors/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/doctors/{id}");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Shops proxy (public GET + admin write) ????????????????????????????????????
// GET /api/shops  — used by citizen search screen (AFP.GET)
app.MapGet("/api/shops", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/shops{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// GET /api/admin/shops  — used by ShopMgmt module
app.MapGet("/api/admin/shops", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/shops{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/admin/shops", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/shops",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/admin/shops/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/shops/{id}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapDelete("/api/admin/shops/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/shops/{id}");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Admin stats + pets proxy ??????????????????????????????????????????????????
app.MapGet("/api/admin/stats", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/admin/stats");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapGet("/api/admin/pets", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/admin/pets");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? User Management proxy ?????????????????????????????????????????????????????
app.MapGet("/api/admin/users", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/admin/users{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/admin/users", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/admin/users",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/admin/users/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/admin/users/{id}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapDelete("/api/admin/users/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/admin/users/{id}");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Reports proxy ?????????????????????????????????????????????????????????????
// GET  /api/reports              - ward_admin+ fetches reports scoped to their ward
// POST /api/reports              - authenticated citizen submits a new report
// PATCH /api/reports/:id/resolve - ward_admin+ marks a report as resolved
app.MapGet("/api/reports", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/reports");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/reports", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/reports",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapMethods("/api/reports/{id:int}/resolve", new[] { "PATCH" }, async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json     = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var patchReq = new HttpRequestMessage(new HttpMethod("PATCH"), $"{backendBase}/api/reports/{id}/resolve")
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
        var resp = await MakeClient(f, ctx.Request).SendAsync(patchReq);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// Report comments proxy ????????????????????????????????????????????????????????
// GET  /api/reports/:id/comments       - list all comments for a report
// POST /api/reports/:id/comments       - add a comment to a report
// PUT  /api/reports/:id/comments/:cid  - update an existing comment
app.MapGet("/api/reports/{id:int}/comments", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/reports/{id}/comments");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/reports/{id:int}/comments", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/reports/{id}/comments",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/reports/{id:int}/comments/{cid:int}", async (int id, int cid, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/reports/{id}/comments/{cid}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Uploads proxy (pet photos, vaccination certificates) ?????????????????????
// Streams raw bytes from Node's /uploads static route with the original
// Content-Type header so <img src="/uploads/pets/1-photo.jpg"> renders in browser.
app.MapGet("/uploads/{**filePath}", async (string? filePath, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(filePath) ? "" : "/" + filePath;
        var client  = f.CreateClient();
        var resp    = await client.GetAsync($"{backendBase}/uploads{segment}");
        if (!resp.IsSuccessStatusCode)
            return Results.NotFound();
        var bytes       = await resp.Content.ReadAsByteArrayAsync();
        var contentType = resp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        return Results.Bytes(bytes, contentType);
    }
    catch
    {
        return Results.NotFound();
    }
});

// ?? Run pending migrations (one-click from super admin) ?????????????????
app.MapPost("/api/admin/run-migrations", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"{backendBase}/admin/run-migrations");
        req.Headers.TryAddWithoutValidation("x-migration-secret", "afp-migrate-2026");
        var auth = ctx.Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrEmpty(auth))
            req.Headers.TryAddWithoutValidation("Authorization", auth);
        var resp = await f.CreateClient().SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return Results.Content(body, "application/json", statusCode: (int)resp.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Migration proxy error: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Discussions proxy (Community Forum) ??????????????????????????????????????
app.MapGet("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs   = ctx.Request.QueryString.Value ?? "";
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapGet("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions/{id}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPut("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/discussions/{id}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapDelete("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/discussions/{id}");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/discussions/{id:int}/replies", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions/{id}/replies",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPut("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PutAsync(
            $"{backendBase}/api/discussions/{id}/replies/{rid}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapDelete("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).DeleteAsync(
            $"{backendBase}/api/discussions/{id}/replies/{rid}");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.Run();
