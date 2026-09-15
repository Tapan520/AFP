# 02 — .NET Backend (`Program.cs`)

This file *is* the entire .NET backend. It uses Minimal APIs; there are no
controllers. All logic lives in `Program.cs` (top-level statements).

## Structure of `Program.cs`

```
1. Builder + Kestrel port binding (PORT env)
2. Services: AddRazorPages, AddHttpClient
3. DB bootstrap (ParseUrl ? NpgsqlDataSource) + eager connectivity test
4. app.UseStaticFiles / UseRouting / UseAuthorization / MapRazorPages
5. Startup migrations (RunSql helper) — idempotent CREATE/ALTER blocks
6. Proxy helpers: MakeClient, SafeGet, GetUserId, ReadRows
7. Endpoints (see catalog below)
8. app.Run()
```

## Endpoint Catalog

Legend: **P** = proxy to Node, **D** = direct Postgres.

### Auth (Node)

| Method | Path | Kind | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | P | Forwards JSON body to Node |
| POST | `/api/auth/register` | P | Same |

### Geo (Node)

| Method | Path | Kind |
|---|---|---|
| GET/POST/PUT | `/api/geo/**` | P |

### Pets — direct

| Method | Path | Kind | Notes |
|---|---|---|---|
| GET | `/api/pets/stats` | D | Totals + per-city species breakdown |
| GET | `/api/pets/search?q=&cityId=` | D | Approved pets only |
| GET | `/api/pets/breeding?species=&breed=&gender=&cityId=` | D | `breeding_opt_in = TRUE` |
| GET | `/api/pets/adoption?cityId=` | D | Newest 20 approved |

### Pets — proxy

| Method | Path | Kind | Notes |
|---|---|---|---|
| GET | `/api/pets/**` | P | Catch-all; missing ? returns `[]` |
| POST | `/api/pets/{id}/upload-photo` | P | Streams raw multipart body |
| POST | `/api/pets/{id}/upload-certificate` | P | Streams raw multipart body |
| POST/PATCH | `/api/pets/**` | P | Generic catch-alls (JSON only) |

### Admin — Pets + Stats

| Method | Path | Kind |
|---|---|---|
| GET | `/api/admin/stats` | P |
| GET | `/api/admin/pets` | P |

### Users (direct)

| Method | Path | Kind | Notes |
|---|---|---|---|
| GET | `/api/admin/users?role=&cityId=&nigamId=&zoneId=&wardId=&q=` | D | Joined with cities/nigams/zones/wards |
| POST | `/api/admin/users` | D | `password_hash = crypt($6, gen_salt('bf', 10))` |
| PUT | `/api/admin/users/{id}` | D | Two code paths — password vs. no-password |
| DELETE | `/api/admin/users/{id}` | D | Blocks deleting yourself via `GetUserId(ctx.Request)` |

### Doctors (direct)

| Method | Path | Kind |
|---|---|---|
| GET | `/api/doctors?cityId=&q=` | D — public search |
| GET | `/api/admin/doctors?cityId=&nigamId=&zoneId=&wardId=&q=` | D — admin list |
| POST | `/api/admin/doctors` | D |
| PUT | `/api/admin/doctors/{id}` | D |
| DELETE | `/api/admin/doctors/{id}` | D |

### Shops (direct) — same shape as Doctors

`/api/shops`, `/api/admin/shops`, POST/PUT/DELETE `/api/admin/shops/{id}`.

### Reports (direct)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/reports` | Auto-scoped by caller's role (ward/zone/nigam/city_admin see only theirs; super_admin sees all) |
| POST | `/api/reports` | Reporter geo inherited from `users` row |
| PATCH | `/api/reports/{id}/resolve` | Sets `status='resolved', resolution_note, resolved_at, resolved_by` |
| GET/POST/PUT | `/api/reports/{id}/comments[/{cid}]` | Comments only editable by author |

### Discussions (direct with Node fallback)

`/api/discussions`, `/api/discussions/{id}`, `/api/discussions/{id}/replies[/{rid}]` —
CRUD. `dbSource == null` triggers a passthrough to Node.

### Billing / Revenue (direct)

- `GET /api/admin/billing?from=&to=&groupBy=ward|zone|nigam|city`
- Role-scoped exactly like Reports.
- Response: `{ rows: [...], summary: { total, approved, pending, revenue } }`.

### Uploads

- `GET /uploads/{**filePath}` — streams bytes from Node's static `/uploads`.

### Diagnostics

- `GET /api/dbstatus` — safe, no credentials returned.
- `GET /api/dbusers` — user list without password hash.
- `GET /api/dbschema` — column metadata for critical tables.
- `POST /api/admin/run-migrations` — proxies to Node's migration endpoint.

## Helpers to reuse

```csharp
MakeClient(f, req)             // HttpClient with Authorization header forwarded
SafeGet(resp, fallback)        // Reads body + returns Content-Type JSON
GetUserId(req)                 // Decodes JWT payload without verifying signature
ReadRows(reader)               // NpgsqlDataReader ? List<Dictionary<string,object?>>
```

Whenever adding a new direct-DB endpoint, follow the existing pattern:

```csharp
app.MapGet("/api/something", async (HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = "…";
        cmd.Parameters.Add(new NpgsqlParameter { Value = … });
        await using var rdr  = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});
```
