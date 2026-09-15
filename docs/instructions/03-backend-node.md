# 03 — Node Backend (`railway-backend/`)

Deployed as a separate Railway service. Talks to the same Postgres.

## Files

```
railway-backend/
??? server.js                    ? Express app, CORS, migrations, mounts routers
??? db.js                        ? pg Pool
??? middleware/auth.js           ? requireAuth / requireRole (JWT verify)
??? routes/
?   ??? auth.js                  ? /api/auth/{register,login}
?   ??? geo.js                   ? cities / nigams / zones / wards CRUD
?   ??? pets.js                  ? pet CRUD, uploads (multer), admin listing
?   ??? adminUsers.js            ? legacy; superseded by .NET
?   ??? doctors.js, shops.js     ? legacy; superseded by .NET direct-DB routes
?   ??? reports.js               ? legacy; superseded by .NET
?   ??? discussions.js           ? forum; still used as fallback by .NET
??? migrations/*.sql             ? Reference SQL files
??? migrate-*.js                 ? Ad-hoc migration scripts
??? e2e-*.js                     ? End-to-end validation scripts
??? README.md                    ? Detailed API reference (kept up to date)
??? package.json                 ? `npm start` ? node server.js
```

## Key Responsibilities

1. **JWT issuance** — `POST /api/auth/login`, `POST /api/auth/register` (bcrypt).
2. **Pet CRUD & file uploads** — multer stores files under `railway-backend/uploads/pets/`, exposed via `express.static("/uploads")`.
3. **Migration endpoint** — `POST /admin/run-migrations` guarded by header
   `x-migration-secret` (default `afp-migrate-2026`).
4. **Startup migrations** — a small idempotent set (see `runMigrations()` in `server.js`).

## What is *not* used anymore

Even though the routers still exist in `railway-backend/routes/`, these are now
handled directly by .NET and Node's copies are **fallback only**:

- `adminUsers.js`, `doctors.js`, `shops.js`, `reports.js`
- `discussions.js` is still used when `dbSource == null` on the .NET side.

## CORS Allow-list (`server.js`)

Includes the Railway frontend URL, common .NET launch profiles, and IIS Express
ports. Add new origins by extending the `allowedOrigins` array or by setting
`CORS_ORIGIN`.

## Auth middleware

```js
requireAuth(req, res, next)          // verifies JWT, attaches req.user
requireRole('ward_admin', 'admin')   // rejects if user.role not in list
```

## Health check

`GET /health` ? `{ status: "ok", db: "connected", ts: "..." }`

For the full endpoint reference see [`railway-backend/README.md`](../../railway-backend/README.md).
