# 01 — Architecture

## Request Flow

```
                ????????????????????????????????????????????
Browser (JS) ????  .NET Razor Pages server (Program.cs)    ?
                ?                                          ?
                ?  ???? proxy ?????  Node backend  ?????????  Postgres
                ?  ?                                       ?
                ?  ???? direct ??????????????????????????????  Postgres
                ????????????????????????????????????????????
```

The .NET server plays **two roles**:

1. **Proxy layer** — forwards most `/api/*` calls to the Node backend at `BACKEND_URL`
   (defaults: `http://localhost:3000` in Dev, Railway URL in Prod).
2. **Direct-DB layer** — for a growing subset of routes, `Program.cs` talks to
   Postgres itself using `Npgsql` and returns JSON. This lets us decommission the
   Node backend piece by piece.

## Which routes hit which layer?

| Category | Endpoint prefix | Handled by |
|---|---|---|
| Auth | `/api/auth/*` | **Node** (still issues JWTs) |
| Geo lookups | `/api/geo/*` | **Node** |
| Pets — CRUD, uploads, admin | `/api/pets/*`, `/api/admin/pets`, `/api/admin/stats` | **Node** |
| Pets — stats / search / breeding / adoption | `/api/pets/stats`, `/search`, `/breeding`, `/adoption` | **.NET direct DB** |
| Doctors & Shops | `/api/doctors`, `/api/shops`, `/api/admin/doctors`, `/api/admin/shops` | **.NET direct DB** |
| User management | `/api/admin/users*` | **.NET direct DB** |
| Reports + comments | `/api/reports*` | **.NET direct DB** |
| Community Forum | `/api/discussions*` | **.NET direct DB** (falls back to Node if `dbSource == null`) |
| Billing / Revenue | `/api/admin/billing` | **.NET direct DB** |
| Uploads (static files) | `/uploads/**` | **.NET ? Node passthrough** |
| Payments | `/api/payment?handler=CreateOrder|Verify` | **.NET ? Razorpay** |
| DB diagnostics | `/api/dbstatus`, `/api/dbusers`, `/api/dbschema` | **.NET direct DB** |

## Authentication

- Node's `POST /api/auth/login` returns `{ token, user }`.
- The JWT payload has: `id, role, city_id, nigam_id, zone_id, ward_id`.
- Frontend stores it in `localStorage` (`afp_token`, `afp_user`) via `AFP.login()`.
- Every `AFP.GET/POST/…` attaches `Authorization: Bearer <token>`.
- The .NET server just forwards the header. For direct-DB routes it decodes the
  JWT payload without verifying signature (see `GetUserId()` in `Program.cs`) to
  extract `id` for scoping/ownership checks. Signature verification lives in the
  Node middleware (`railway-backend/middleware/auth.js`).

## Startup Migrations

`Program.cs` runs a large idempotent SQL migration block on every start (all
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). This makes the .NET
server usable against a fresh Postgres OR an existing one seeded by the old Node
backend. The Node backend runs its own smaller migration set on start too
(`runMigrations()` in `server.js`). Duplication is intentional; both are safe.

## Environment Variables (.NET)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection URL (Railway public or `.railway.internal`) |
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT` | Alternative to `DATABASE_URL` |
| `BACKEND_URL` | Node backend base URL (defaults to Railway in Prod) |
| `PORT` | Bind port (Railway sets it) |
| `Razorpay:KeyId`, `Razorpay:KeySecret` | Razorpay creds via `IConfiguration` |
| `Payment:TestMode`, `Payment:RegistrationFee`, `Payment:RenewalFee`, `Payment:TransferFee`, `Payment:Currency` | Payment defaults |

## Environment Variables (Node)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection URL |
| `JWT_SECRET` | JWT signing key (must match what middleware verifies against) |
| `CORS_ORIGIN` | The .NET frontend origin (see `server.js` allow list) |
| `PORT` | HTTP port |
| `MIGRATION_SECRET` | Header key for `POST /admin/run-migrations` |
