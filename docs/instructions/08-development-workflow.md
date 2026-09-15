# 08 — Development Workflow

## Prerequisites

- .NET 8 SDK
- Node.js 18+ (only if running the Node backend locally)
- PostgreSQL — local instance or a Railway `DATABASE_URL`

## Run — .NET only (against Railway backend)

```powershell
cd C:\CursorProjects\AFP
$env:BACKEND_URL="https://web-production-06875.up.railway.app"
$env:DATABASE_URL="postgresql://…"       # Railway public URL
dotnet run
```

Visit <https://localhost:7207> (or the port from `Properties/launchSettings.json`).

## Run — Full local stack

Terminal A — Node backend:

```powershell
cd C:\CursorProjects\AFP\railway-backend
npm install
$env:DATABASE_URL="postgresql://…"
$env:JWT_SECRET="dev_secret_change_me"
$env:PORT=3000
npm start
```

Terminal B — .NET:

```powershell
cd C:\CursorProjects\AFP
$env:BACKEND_URL="http://localhost:3000"
$env:DATABASE_URL="postgresql://…"
dotnet run
```

## Building

```powershell
dotnet build           # or use run_build tool
```

The build validates C# only; static JS/CSS are copied as-is.

## Migrations

Both servers auto-migrate on start. Manual invocation:

```
POST https://<node-host>/admin/run-migrations
Header: x-migration-secret: afp-migrate-2026
```

Ad-hoc SQL scripts under `railway-backend/migrations/*.sql` are historical
references — the canonical schema is in `Program.cs` and `server.js`.

## Diagnostics Endpoints (safe to call in prod)

- `GET /api/dbstatus` — connection state, host, user count.
- `GET /api/dbschema` — column list for critical tables.
- `GET /api/dbusers` — user list without password hashes.

## Git Workflow

```
main   ? protected; deploys automatically
```

Standard flow used across this repo:

```powershell
# stage ? commit ? push
cd C:\CursorProjects\AFP
git add <files>
git commit -m "type: short imperative description"
git push origin main
```

Windows PowerShell notes:
- `&&` **doesn't work**. Use `;` between commands or a `cmd /c "…"` wrapper.
- Multi-line commit messages fail; use a single short line.

Commit prefixes seen in this repo: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.

## Deployment

- **.NET frontend** — Railway service, root = repo root, auto-detected .NET 8 Web project. `PORT` is injected.
- **Node backend** — Railway service, root = `railway-backend/`, `npm start`. Needs Postgres plugin + env vars.

Set `BACKEND_URL` on the .NET service to point at the Node service's Railway URL.

## Adding a Feature — Checklist

1. **Backend endpoint** — add to `Program.cs` (prefer direct-DB). Follow patterns in [`02-backend-dotnet.md`](./02-backend-dotnet.md).
2. **Schema change** — extend the migration block; document in [`06-database-schema.md`](./06-database-schema.md).
3. **JS module** — new file or extend existing; register in `_AppLayout.cshtml` **before** `afp-screens.js`.
4. **Razor markup** — add screen `<div>` in `Index.cshtml`; wire `_patchedGo` if it has a form.
5. **Validation** — declare fields in the `FORMS` map inside `afp-validation.js`.
6. **Docs** — update the relevant `docs/instructions/*.md` file.
7. **Build + run** — `dotnet build`.
8. **Commit + push**.
