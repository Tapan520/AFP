# All For Pets — Municipal Pet Registry 🐾

A full-stack pet-licensing portal for Indian municipal corporations.

* **Front-end / API proxy** — ASP.NET Core 8 Razor Pages (`AFP.csproj`)
* **Back-end / data API**  — Node 18+ Express + MySQL (`railway-backend/`)
* **Mobile wrapper**       — Capacitor 6 (Android + iOS)

---

## Run locally

You need **.NET 8 SDK**, **Node 18+**, and a **MySQL 8** instance
(local or hosted). The Node backend listens on `http://localhost:3000` and
the Razor Pages app proxies to it, so start the backend first.

### 1. Backend (Node + Express)

```powershell
cd railway-backend

# One-off: install deps
npm install

# Copy the sample env file and fill in real values (DB, JWT secret, etc.)
Copy-Item .env.example .env
# then edit .env

# Run migrations (creates tables + seeds cities/nigams/wards)
node scripts/run-migrations.js         # optional if your DB is already migrated

# Start the API on http://localhost:3000
npm run dev                             # nodemon (auto-restart)
# or
npm start                               # plain node
```

Health check: <http://localhost:3000/health> — should return
`{ "status": "ok", "db": "connected", … }`.

### 2. Front-end (.NET 8 Razor Pages)

```powershell
# From the repo root
dotnet restore
dotnet run                              # https://localhost:7207 / http://localhost:5009
```

Open <https://localhost:7207> in your browser. All `/api/*` calls are proxied
to `http://localhost:3000` in Development (see `appsettings.Development.json`).

### 3. Tests

```powershell
# .NET unit + smoke tests (xUnit)
dotnet test                             # 23 tests

# End-to-end portal API test (needs live backend — set SA_PASSWORD first!)
$env:SA_MOBILE   = "9999999999"
$env:SA_PASSWORD = "your-super-admin-password"
node test-portal.js
```

### 4. Mobile app (optional)

```powershell
npm install                             # from repo root — installs Capacitor
npm run cap:add:android
npm run cap:sync
npm run cap:open:android                # opens Android Studio
```

Full guide: [`capacitor/README.md`](capacitor/README.md).

---

## Project layout

```
AFP/
├── AFP.csproj                 .NET 8 Razor Pages (front-end + API proxy)
├── AFP.Tests/                 xUnit test project
├── Pages/                     Razor pages (Index, PetProfile, PetCertificate, …)
├── Services/                  PaymentService, CdnUrlResolver, …
├── wwwroot/                   Static assets (JS modules, CSS)
├── railway-backend/           Node/Express API + storage abstraction
│   ├── routes/                auth, pets, geo, admin*, adminAnalytics, …
│   ├── storage/               local | s3 | azure | cloudinary provider
│   ├── config/env.js          dotenv-safe bootstrap
│   └── server.js              Express entry point (helmet + rate-limit)
├── capacitor.config.json      Mobile wrapper config
├── package.json               Capacitor scripts + deps
└── .editorconfig              Formatting rules for JS + C# + Razor
```

## Environment variables (backend)

The canonical list lives in `railway-backend/.env.example` and is enforced by
`dotenv-safe` at boot. Highlights:

| Var | Purpose |
|---|---|
| `DATABASE_URL`               | MySQL connection string (Railway/PlanetScale/local) |
| `JWT_SECRET` / `REFRESH_JWT_SECRET` | Token signing keys (min 32 chars) |
| `STORAGE_PROVIDER`           | `local` \| `s3` \| `azure` \| `cloudinary` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments (test-mode auto-skips SDK) |
| `CORS_ORIGIN`                | Deployed front-end origin |

## Security defaults

* `helmet()` — secure HTTP headers on every response.
* `express-rate-limit` — 300 req/min per IP globally, **20 req/min on `/api/auth/*`**
  to blunt credential-stuffing.
* Passwords — **minimum 8 chars, ≥1 letter + ≥1 digit** (enforced by
  `validatePassword` in `routes/auth.js`, reused by admin user create/update).
* `.env` files ignored by git; backup dumps kept out of the repo.
* All uploads streamed through the storage abstraction — no on-disk state in
  production.

## License

MIT © All For Pets contributors.
