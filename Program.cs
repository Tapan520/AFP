using Npgsql;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT at runtime � bind to it so the service is reachable
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddRazorPages();
builder.Services.AddHttpClient();

// Direct DB connection - implements discussion forum without relying on the old backend
// Railway DATABASE_URL uses postgres:// scheme - parsed manually as System.Uri rejects it
var dbConnStr = Environment.GetEnvironmentVariable("DATABASE_URL");
NpgsqlDataSource? dbSource = null;
string? dbInitError = null;
if (!string.IsNullOrEmpty(dbConnStr))
{
    try
    {
        // Strip scheme prefix (postgres:// or postgresql://)
        var s = dbConnStr;
        if      (s.StartsWith("postgresql://")) s = s.Substring("postgresql://".Length);
        else if (s.StartsWith("postgres://"))   s = s.Substring("postgres://".Length);

        // Split userinfo@host/db  ->  find the LAST '@' to handle passwords with '@'
        var atIdx    = s.LastIndexOf('@');
        var userInfo = s.Substring(0, atIdx);
        var hostPart = s.Substring(atIdx + 1);

        // user:password
        var ci   = userInfo.IndexOf(':');
        var user = ci >= 0 ? userInfo.Substring(0, ci) : userInfo;
        var pass = ci >= 0 ? userInfo.Substring(ci + 1) : "";

        // host:port/database
        var si       = hostPart.IndexOf('/');
        var hostPort = si >= 0 ? hostPart.Substring(0, si) : hostPart;
        var database = si >= 0 ? hostPart.Substring(si + 1) : "railway";

        // host:port
        var pi      = hostPort.LastIndexOf(':');
        var host    = pi >= 0 ? hostPort.Substring(0, pi) : hostPort;
        var portStr = pi >= 0 ? hostPort.Substring(pi + 1) : "5432";

        var csb = new NpgsqlConnectionStringBuilder
        {
            Host                   = host,
            Port                   = int.TryParse(portStr, out var p) ? p : 5432,
            Database               = database,
            Username               = Uri.UnescapeDataString(user),
            Password               = Uri.UnescapeDataString(pass),
            SslMode                = SslMode.Disable,
            TrustServerCertificate = true,
        };
        dbSource = NpgsqlDataSource.Create(csb.ConnectionString);
        Console.WriteLine($"DB source initialized: {host}:{portStr}/{database}");
    }
    catch (Exception ex)
    {
        dbInitError = ex.Message;
        Console.WriteLine($"DB init error: {ex.Message}");
    }
}

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

// Note: HTTPS redirection is intentionally omitted � Railway terminates TLS
// at the edge proxy, so enforcing it inside the container causes redirect loops.
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();
app.MapRazorPages();

// Ensure discussion tables exist (idempotent - safe every deploy).
if (dbSource != null)
{
    try
    {
        await using var mc = await dbSource.OpenConnectionAsync();
        await using var mm = mc.CreateCommand();
        mm.CommandText = @"
            CREATE TABLE IF NOT EXISTS discussions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(200) NOT NULL,
                body TEXT NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'general',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS discussion_replies (
                id SERIAL PRIMARY KEY,
                discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_disc_cat ON discussions(category);
            CREATE INDEX IF NOT EXISTS idx_disc_repl ON discussion_replies(discussion_id);
            ";
        await mm.ExecuteNonQueryAsync();
        Console.WriteLine("Discussion tables ready.");
    }
    catch (Exception ex) { Console.WriteLine($"Discussion migration: {ex.Message}"); }
}

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

// Decode JWT payload to extract user id (token already issued by the Node backend).
static int? GetUserId(HttpRequest req)
{
    var auth = req.Headers["Authorization"].FirstOrDefault();
    if (string.IsNullOrEmpty(auth) || !auth.StartsWith("Bearer ")) return null;
    var parts = auth.Substring(7).Split('.');
    if (parts.Length != 3) return null;
    try
    {
        var padded = parts[1].PadRight(parts[1].Length + (4 - parts[1].Length % 4) % 4, '=');
        var jStr   = System.Text.Encoding.UTF8.GetString(
                         Convert.FromBase64String(padded.Replace('-', '+').Replace('_', '/')));
        using var jDoc = System.Text.Json.JsonDocument.Parse(jStr);
        if (jDoc.RootElement.TryGetProperty("id", out var el) && el.TryGetInt32(out var uid))
            return uid;
    }
    catch { }
    return null;
}

// Read all rows from NpgsqlDataReader into list of dictionaries.
static async Task<List<Dictionary<string, object?>>> ReadRows(NpgsqlDataReader reader)
{
    var rows = new List<Dictionary<string, object?>>();
    while (await reader.ReadAsync())
    {
        var row = new Dictionary<string, object?>();
        for (int i = 0; i < reader.FieldCount; i++)
        {
            var v = reader.GetValue(i);
            row[reader.GetName(i)] = v is DBNull ? null : v;
        }
        rows.Add(row);
    }
    return rows;
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
// ?? Upload proxy � raw stream passthrough (MUST be before generic POST catch-all) ??????????
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
// GET /api/doctors  � used by citizen search screen (AFP.GET)
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

// GET /api/admin/doctors  � used by DoctorMgmt module
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
// GET /api/shops  � used by citizen search screen (AFP.GET)
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

// GET /api/admin/shops  � used by ShopMgmt module
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

// ?? DB status diagnostic (safe - never exposes credentials) ????????????????
app.MapGet("/api/dbstatus", async () =>
{
    if (dbSource == null)
        return Results.Json(new {
            db          = "not_configured",
            has_env     = !string.IsNullOrEmpty(dbConnStr),
            init_error  = dbInitError,
            hint        = "Set DATABASE_URL env var on Railway AFP service"
        });
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*)::int FROM users";
        var count = await cmd.ExecuteScalarAsync();
        return Results.Json(new { db = "connected", users = count });
    }
    catch (Exception ex)
    {
        return Results.Json(new { db = "error", message = ex.Message }, statusCode: 500);
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

// ?? Discussions - implemented directly against PostgreSQL (old backend not redeployed)
app.MapGet("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var qs2   = ctx.Request.QueryString.Value ?? "";
            var resp2 = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions{qs2}");
            return resp2.StatusCode == System.Net.HttpStatusCode.NotFound
                ? Results.Content("[]", "application/json") : await SafeGet(resp2, "[]");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    try
    {
        var cat = ctx.Request.Query["category"].FirstOrDefault();
        var q   = ctx.Request.Query["q"].FirstOrDefault();
        var w   = new List<string>();
        var p   = new List<NpgsqlParameter>();
        int n   = 1;
        if (!string.IsNullOrEmpty(cat)) { w.Add($"d.category = ${n++}"); p.Add(new NpgsqlParameter { Value = cat }); }
        if (!string.IsNullOrEmpty(q))   { w.Add($"(d.title ILIKE ${n} OR d.body ILIKE ${n})"); n++; p.Add(new NpgsqlParameter { Value = $"%{q}%" }); }
        var ws = w.Count > 0 ? "WHERE " + string.Join(" AND ", w) : "";
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT d.*, u.name AS author_name, COUNT(r.id)::int AS reply_count
            FROM discussions d
            LEFT JOIN users u ON u.id = d.user_id
            LEFT JOIN discussion_replies r ON r.discussion_id = d.id
            {ws}
            GROUP BY d.id, u.name ORDER BY d.created_at DESC LIMIT 100
            """;
        foreach (var pm in p) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions/{id}");
            return resp2.StatusCode == System.Net.HttpStatusCode.NotFound
                ? Results.Json(new { error = "Discussion not found." }, statusCode: 404) : await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = """
            SELECT d.*, u.name AS author_name, COUNT(r.id)::int AS reply_count
            FROM discussions d
            LEFT JOIN users u ON u.id = d.user_id
            LEFT JOIN discussion_replies r ON r.discussion_id = d.id
            WHERE d.id = $1 GROUP BY d.id, u.name
            """;
        cmd.Parameters.Add(new NpgsqlParameter { Value = id });
        await using var rdr  = await cmd.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        if (rows.Count == 0) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        var thread = rows[0];
        await rdr.DisposeAsync(); await cmd.DisposeAsync();
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = """
            SELECT r.*, u.name AS author_name
            FROM discussion_replies r LEFT JOIN users u ON u.id = r.user_id
            WHERE r.discussion_id = $1 ORDER BY r.created_at ASC
            """;
        cmd2.Parameters.Add(new NpgsqlParameter { Value = id });
        await using var rdr2 = await cmd2.ExecuteReaderAsync();
        thread["replies"] = await ReadRows(rdr2);
        return Results.Json(thread);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var title    = doc.RootElement.TryGetProperty("title",    out var t) ? t.GetString() : null;
        var bodyText = doc.RootElement.TryGetProperty("body",     out var b) ? b.GetString() : null;
        var category = doc.RootElement.TryGetProperty("category", out var c) ? c.GetString() : "general";
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(bodyText))
            return Results.Json(new { error = "title and body are required." }, statusCode: 400);
        if (title.Length > 200)
            return Results.Json(new { error = "Title must be 200 characters or less." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var ins  = conn.CreateCommand();
        ins.CommandText = "INSERT INTO discussions (user_id, title, body, category) VALUES ($1,$2,$3,$4) RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = title.Trim() });
        ins.Parameters.Add(new NpgsqlParameter { Value = bodyText.Trim() });
        ins.Parameters.Add(new NpgsqlParameter { Value = category ?? "general" });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();
        await using var sel = conn.CreateCommand();
        sel.CommandText = """
            SELECT d.*, u.name AS author_name, 0::int AS reply_count
            FROM discussions d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = $1
            """;
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/discussions/{id}",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var title    = doc.RootElement.TryGetProperty("title", out var t) ? t.GetString() : null;
        var bodyText = doc.RootElement.TryGetProperty("body",  out var b) ? b.GetString() : null;
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only edit your own posts." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var upd = conn.CreateCommand();
        upd.CommandText = "UPDATE discussions SET title=COALESCE($1,title), body=COALESCE($2,body), updated_at=NOW() WHERE id=$3";
        upd.Parameters.Add(new NpgsqlParameter { Value = (object?)title?.Trim() ?? DBNull.Value });
        upd.Parameters.Add(new NpgsqlParameter { Value = (object?)bodyText?.Trim() ?? DBNull.Value });
        upd.Parameters.Add(new NpgsqlParameter { Value = id });
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapDelete("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/discussions/{id}");
            return await SafeGet(resp2, "{}");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only delete your own posts." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var del = conn.CreateCommand();
        del.CommandText = "DELETE FROM discussions WHERE id = $1";
        del.Parameters.Add(new NpgsqlParameter { Value = id });
        await del.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Deleted." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/discussions/{id:int}/replies", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions/{id}/replies",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var text = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString()?.Trim() : null;
        if (string.IsNullOrWhiteSpace(text))
            return Results.Json(new { error = "Reply body is required." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        if (await chk.ExecuteScalarAsync() == null)
            return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        await chk.DisposeAsync();
        await using var ins = conn.CreateCommand();
        ins.CommandText = "INSERT INTO discussion_replies (discussion_id, user_id, body) VALUES ($1,$2,$3) RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter { Value = id });
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = text });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();
        await using var sel = conn.CreateCommand();
        sel.CommandText = "SELECT r.*, u.name AS author_name FROM discussion_replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = $1";
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PutAsync(
                $"{backendBase}/api/discussions/{id}/replies/{rid}",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var text = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString()?.Trim() : null;
        if (string.IsNullOrWhiteSpace(text))
            return Results.Json(new { error = "Reply body is required." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2";
        chk.Parameters.Add(new NpgsqlParameter { Value = rid });
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Reply not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only edit your own replies." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var upd = conn.CreateCommand();
        upd.CommandText = "UPDATE discussion_replies SET body = $1, updated_at = NOW() WHERE id = $2";
        upd.Parameters.Add(new NpgsqlParameter { Value = text });
        upd.Parameters.Add(new NpgsqlParameter { Value = rid });
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapDelete("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).DeleteAsync(
                $"{backendBase}/api/discussions/{id}/replies/{rid}");
            return await SafeGet(resp2, "{}");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2";
        chk.Parameters.Add(new NpgsqlParameter { Value = rid });
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Reply not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only delete your own replies." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var del = conn.CreateCommand();
        del.CommandText = "DELETE FROM discussion_replies WHERE id = $1";
        del.Parameters.Add(new NpgsqlParameter { Value = rid });
        await del.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Deleted." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.Run();
