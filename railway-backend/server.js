// ?????????????????????????????????????????????????????????????????????????????
// server.js  -  AllForPets Municipal Portal  -  Express API (MySQL backend)
// ?????????????????????????????????????????????????????????????????????????????
// Env loading & validation MUST come before anything that reads process.env.
require("./config/env");

const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const path       = require("path");
const pool       = require("./db");
const { PROVIDER: STORAGE_PROVIDER } = require("./storage");

// ?? Route modules ?????????????????????????????????????????????????????????????
const authRouter        = require("./routes/auth");
const geoRouter         = require("./routes/geo");
const petsRouter        = require("./routes/pets");
const adminUsersRouter  = require("./routes/adminUsers");
const adminBackupsRouter  = require("./routes/adminBackups");
const adminAnalyticsRouter= require("./routes/adminAnalytics");
const adminAuditLogsRouter= require("./routes/adminAuditLogs");
const doctorsRouter     = require("./routes/doctors");
const shopsRouter       = require("./routes/shops");
const reportsRouter     = require("./routes/reports");
const discussionsRouter = require("./routes/discussions");
const billingRouter     = require("./routes/billing");
const adminSearchRouter = require("./routes/adminSearch");

const app  = express();
const PORT = process.env.PORT || 3000;

// ?? Security hardening (helmet + rate limit) ?????????????????????????????
// helmet() sets a suite of secure default HTTP headers.
// We enable a strict-ish CSP suitable for our web UI:
//   • self scripts + jsdelivr (Swagger UI + Chart.js CDN + Razorpay SDK).
//   • self + jsdelivr styles + inline styles (many inline `style="..."` attrs
//     across the Razor partials — needed for now, tighten later once we
//     externalise them).
//   • img-src includes data: (QR codes, avatars) and https: (S3/Cloudinary/CDN).
//   • connect-src limited to self + the Node API + Razorpay for XHR/WebSocket.
// The mobile Expo app is NOT affected by CSP (native fetch bypasses it).
const CSP_CONNECT = [
  "'self'",
  process.env.CORS_ORIGIN,
  "https://afp.up.railway.app",
  "https://api.razorpay.com",
  "https://checkout.razorpay.com",
].filter(Boolean);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src":  ["'self'"],
      "script-src":   ["'self'", "'unsafe-inline'",
                       "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com",
                       "https://checkout.razorpay.com"],
      "style-src":    ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net",
                       "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      "font-src":     ["'self'", "https://fonts.gstatic.com", "data:"],
      "img-src":      ["'self'", "data:", "blob:", "https:"],
      "connect-src":  CSP_CONNECT,
      "frame-src":    ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      "object-src":   ["'none'"],
      "base-uri":     ["'self'"],
      "form-action":  ["'self'"],
    },
  },
}));

// Global rate limit + a tighter one on /api/auth/* to blunt credential-stuffing.
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }));

// ?? CORS ??????????????????????????????????????????????????????????????????????
// Allow the .NET frontend origin plus local development
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  // Railway production frontend
  "https://afp.up.railway.app",
  // .NET launchSettings.json profiles
  "https://localhost:7207",
  "http://localhost:5009",
  // IIS Express
  "http://localhost:11404",
  "https://localhost:44389",
  // Generic local fallbacks
  "http://localhost:5000",
  "http://localhost:7000",
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin '${origin}' not allowed.`));
    },
    credentials: true,
  })
);

// ?? Body parsers ??????????????????????????????????????????????????????????????
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// ?? Static uploads (pet photos, certificates) ???????????????????????????????????
// Only mount /uploads when using the local storage provider. When STORAGE_PROVIDER
// is s3/azure/cloudinary the files live in the CDN and this route is a no-op.
if (STORAGE_PROVIDER === "local") {
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
}

// ?? Health check ??????????????????????????????????????????????????????????????
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: "error", db: err.message });
  }
});

// ── API contract: OpenAPI spec + Swagger UI (mobile team + API consumers) ────
// The spec lives at railway-backend/openapi.yaml (hand-authored) and is served
// verbatim so `openapi-typescript-codegen` / Postman / Insomnia can consume it.
// Swagger UI is loaded from a public CDN — zero backend npm dependency.
app.get("/api/openapi.yaml", (_req, res) => {
  res.type("application/yaml");
  res.sendFile(path.join(__dirname, "openapi.yaml"));
});
app.get("/api/docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/>
  <title>AFP API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body { margin:0 } .topbar { display:none }</style>
</head><body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/openapi.yaml",
      dom_id: "#swagger",
      deepLinking: true,
      persistAuthorization: true,
    });
  </script>
</body></html>`);
});

// ?? Run-once migration endpoint ??????????????????????????????????????????????
// POST /admin/run-migrations  (secret key required)
// Used to apply pending migrations when git/CLI deploy is unavailable.
app.post("/admin/run-migrations", async (req, res) => {
  const secret = req.headers["x-migration-secret"] || "";
  if (!secret || secret !== (process.env.MIGRATION_SECRET || "afp-migrate-2026")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const results = [];
  const sqls = [
    {
      label: "report_comments table",
      sql: `CREATE TABLE IF NOT EXISTS report_comments (
        id         SERIAL      PRIMARY KEY,
        report_id  INTEGER     NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        admin_id   INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        comment    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: "report_comments index",
      sql: `CREATE INDEX IF NOT EXISTS idx_report_comments_report_id ON report_comments(report_id)`,
    },
    {
      label: "discussions table",
      sql: `CREATE TABLE IF NOT EXISTS discussions (
        id         SERIAL       PRIMARY KEY,
        user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      VARCHAR(200) NOT NULL,
        body       TEXT         NOT NULL,
        category   VARCHAR(50)  NOT NULL DEFAULT 'general',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: "discussion_replies table",
      sql: `CREATE TABLE IF NOT EXISTS discussion_replies (
        id            SERIAL      PRIMARY KEY,
        discussion_id INTEGER     NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        user_id       INTEGER     NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
        body          TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      label: "discussions indexes",
      sql: `CREATE INDEX IF NOT EXISTS idx_discussions_category ON discussions(category);
            CREATE INDEX IF NOT EXISTS idx_disc_replies_discussion_id ON discussion_replies(discussion_id)`,
    },
  ];
  for (const { label, sql } of sqls) {
    try {
      await pool.query(sql);
      results.push({ label, status: "ok" });
    } catch (err) {
      results.push({ label, status: "error", error: err.message });
    }
  }
  res.json({ applied: results });
});

// ?? Routes ????????????????????????????????????????????????????????????????????

// Auth
app.use("/api/auth", authRouter);

// Geo (cities / nigams / wards)
app.use("/api/geo", geoRouter);

// Pets - public + citizen routes
app.use("/api/pets", petsRouter);

// Pets - admin stats  (mounted separately so the path matches the frontend call)
// GET /api/admin/stats  ?  handled inside pets router at /admin/stats
app.get("/api/admin/stats", async (req, _res, next) => {
  // re-use the pets router handler by forwarding
  req.url = "/admin/stats";
  petsRouter(req, _res, next);
});

// Pets - admin full list  GET /api/admin/pets
app.get("/api/admin/pets", async (req, _res, next) => {
  req.url = "/admin/all";
  petsRouter(req, _res, next);
});

// Users management  (ward_admin and above)
app.use("/api/admin/users", adminUsersRouter);

// Backups (super_admin only) — manual runs + on/off daily schedule
app.use("/api/admin/backups", adminBackupsRouter);

// Analytics dashboard (ward_admin and above; results are geo-scoped)
app.use("/api/admin/analytics", adminAnalyticsRouter);

// Activity / audit logs (super_admin only)
app.use("/api/admin/audit-logs", adminAuditLogsRouter);

// Doctors  (public GET + super_admin write)
app.use("/api/doctors", doctorsRouter);
// Alias used by the admin UI (afp-doctorshop-mgmt.js)
app.use("/api/admin/doctors", doctorsRouter);

// Shops  (public GET + super_admin write)
app.use("/api/shops", shopsRouter);
// Alias used by the admin UI
app.use("/api/admin/shops", shopsRouter);

// Reports
app.use("/api/reports", reportsRouter);


// Community Forum discussions
app.use("/api/discussions", discussionsRouter);

// Billing & revenue report (ward_admin+)
app.use("/api/admin/billing", billingRouter);

// Global cross-search across users / pets / doctors / shops (ward_admin+)
app.use("/api/admin/search", adminSearchRouter);

// ?? 404 catch-all ?????????????????????????????????????????????????????????????
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ?? Global error handler ??????????????????????????????????????????????????????
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error." });
});

// ?? Startup migrations ????????????????????????????????????????????????????????
// These ALTER TABLE statements are idempotent (IF NOT EXISTS) so they are safe
// to run on every boot against both fresh and existing databases.

// MySQL-safe helper: some older/current MySQL versions do NOT support
// `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, which caused the db.js SQL
// translator to leave the syntax untouched and the ALTER to silently fail
// (or succeed as a no-op on servers that do accept it). This helper checks
// information_schema first and only issues the ALTER when the column is
// really missing, so it's truly idempotent on every MySQL flavour.
async function ensureColumn(table, column, definition) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = $1
           AND COLUMN_NAME  = $2`,
      [table, column]
    );
    const exists = rows && rows[0] && Number(rows[0].c) > 0;
    if (exists) return;
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migration: added ${table}.${column}`);
  } catch (err) {
    console.error(`Migration ensureColumn(${table}.${column}) failed:`, err.message);
  }
}

async function runMigrations() {
  const migrations = [
    // reports resolution columns
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note TEXT`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at     TIMESTAMPTZ`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    // reports geo columns — added after initial schema was deployed
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS city_id  INTEGER REFERENCES cities(id)  ON DELETE SET NULL`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS nigam_id INTEGER REFERENCES nigams(id)  ON DELETE SET NULL`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS zone_id  INTEGER REFERENCES zones(id)   ON DELETE SET NULL`,
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS ward_id  INTEGER REFERENCES wards(id)   ON DELETE SET NULL`,
    // pets breeding column
    `ALTER TABLE pets ADD COLUMN IF NOT EXISTS breeding_opt_in BOOLEAN NOT NULL DEFAULT FALSE`,
    // nigams fee columns
    `ALTER TABLE nigams ADD COLUMN IF NOT EXISTS registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200`,
    `ALTER TABLE nigams ADD COLUMN IF NOT EXISTS renewal_fee      NUMERIC(10,2) NOT NULL DEFAULT 150`,
    `ALTER TABLE nigams ADD COLUMN IF NOT EXISTS transfer_fee     NUMERIC(10,2) NOT NULL DEFAULT 100`,
    // nigam_fee_history — append-only per-field audit trail so a nigam
    // can prove exactly when a rate changed and who made the change.
    // (fees_updated_at / fees_updated_by are added via ensureColumn() below,
    // because MySQL rejects `ADD COLUMN IF NOT EXISTS` on many versions.)
    `CREATE TABLE IF NOT EXISTS nigam_fee_history (
        id          SERIAL       PRIMARY KEY,
        nigam_id    INTEGER      NOT NULL REFERENCES nigams(id) ON DELETE CASCADE,
        field       VARCHAR(30)  NOT NULL,
        old_value   NUMERIC(10,2) NULL,
        new_value   NUMERIC(10,2) NOT NULL,
        changed_by  INTEGER      NULL REFERENCES users(id) ON DELETE SET NULL,
        changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_nfh_nigam_changed ON nigam_fee_history(nigam_id, changed_at)`,
    // ── Per-species / per-size fee rules (extends per-nigam flat fees) ────
    // When no matching row exists here, the payment engine falls back to the
    // nigams.registration_fee / renewal_fee / transfer_fee columns (backwards
    // compatible — nothing breaks if a nigam hasn't configured the matrix).
    //   species       ∈ 'dog' | 'cat' | 'other'
    //   size_category ∈ 'large_aggressive' | 'small' | 'single'
    // Unique constraint prevents duplicates per (nigam, species, size).
    `CREATE TABLE IF NOT EXISTS nigam_fee_rules (
        id                SERIAL        PRIMARY KEY,
        nigam_id          INTEGER       NOT NULL REFERENCES nigams(id) ON DELETE CASCADE,
        species           VARCHAR(20)   NOT NULL,
        size_category     VARCHAR(20)   NOT NULL,
        registration_fee  NUMERIC(10,2) NOT NULL DEFAULT 0,
        renewal_fee       NUMERIC(10,2) NOT NULL DEFAULT 0,
        transfer_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_by        INTEGER       NULL REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_nfr_nigam_sp_size
        ON nigam_fee_rules(nigam_id, species, size_category)`,
    // report_comments table (from migrations/add_report_comments.sql)
    `CREATE TABLE IF NOT EXISTS report_comments (
        id         SERIAL      PRIMARY KEY,
        report_id  INTEGER     NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        admin_id   INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        comment    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_report_comments_report_id ON report_comments(report_id)`,
    // discussions tables
    `CREATE TABLE IF NOT EXISTS discussions (
        id         SERIAL       PRIMARY KEY,
        user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      VARCHAR(200) NOT NULL,
        body       TEXT         NOT NULL,
        category   VARCHAR(50)  NOT NULL DEFAULT 'general',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS discussion_replies (
        id            SERIAL      PRIMARY KEY,
        discussion_id INTEGER     NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        user_id       INTEGER     NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
        body          TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_discussions_category       ON discussions(category)`,
    `CREATE INDEX IF NOT EXISTS idx_disc_replies_discussion_id ON discussion_replies(discussion_id)`,
    // activity / audit logs (super_admin viewable)
    `CREATE TABLE IF NOT EXISTS activity_logs (
        id         SERIAL       PRIMARY KEY,
        user_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        action     VARCHAR(80)  NOT NULL,
        details    TEXT         NULL,
        ip_address VARCHAR(64)  NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id    ON activity_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_action     ON activity_logs(action)`,

    // ── Performance indexes for scale (10k+ users / city) ─────────────────────────────────
    // All are idempotent — the db shim swallows ER_DUP_KEYNAME on MySQL <8.0.
    // Users: login lookup + admin listings
    `CREATE INDEX IF NOT EXISTS idx_users_mobile         ON users(mobile)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_city_role      ON users(city_id, role, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_users_ward_role      ON users(ward_id, role, is_active)`,
    // Pets: owner dashboard, ward-scoped pending / stats, licence expiry sweeps
    `CREATE INDEX IF NOT EXISTS idx_pets_owner           ON pets(owner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_city_status     ON pets(city_id, registration_status)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_ward_status     ON pets(ward_id, registration_status)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_expiry          ON pets(licence_expiry_date)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_species         ON pets(species, registration_status)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_created         ON pets(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_pets_petid           ON pets(pet_id)`,
    // Reports: ward/zone/nigam/city scoped listings
    `CREATE INDEX IF NOT EXISTS idx_reports_ward         ON reports(ward_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_city         ON reports(city_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_status       ON reports(status, created_at)`,
    // Doctors / shops: public geo-filtered lookup
    `CREATE INDEX IF NOT EXISTS idx_doctors_city_active  ON doctors(city_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_doctors_ward         ON doctors(ward_id)`,
    `CREATE INDEX IF NOT EXISTS idx_shops_city_active    ON shops(city_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_shops_ward           ON shops(ward_id)`,
    // Discussions & forum
    `CREATE INDEX IF NOT EXISTS idx_discussions_user     ON discussions(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_discussions_created  ON discussions(created_at)`,

    // ── Device-bound refresh tokens (mobile app + web) ────────────────────────
    // Opaque high-entropy tokens hashed with SHA-256. One row per (user, device)
    // pair. `expo_push_token` lets us send push notifications to the same
    // device without a separate registration API.
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
        id              SERIAL       PRIMARY KEY,
        user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash      VARCHAR(64)  NOT NULL,
        device_label    VARCHAR(200) NULL,
        expo_push_token VARCHAR(200) NULL,
        ip_address      VARCHAR(64)  NULL,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_used_at    TIMESTAMPTZ  NULL,
        expires_at      TIMESTAMPTZ  NOT NULL,
        revoked_at      TIMESTAMPTZ  NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash)`,
    `CREATE INDEX IF NOT EXISTS        idx_refresh_tokens_user    ON refresh_tokens(user_id)`,
    `CREATE INDEX IF NOT EXISTS        idx_refresh_tokens_expiry  ON refresh_tokens(expires_at)`,
  ];
  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error("Migration warning:", err.message);
    }
  }

  // MySQL-safe column adds (real information_schema check + ALTER).
  // On MySQL these must NOT use "IF NOT EXISTS" — see ensureColumn() docstring.
  await ensureColumn("nigams", "fees_updated_at", "TIMESTAMP NULL");
  await ensureColumn("nigams", "fees_updated_by", "INT NULL");

  console.log("Migrations applied.");
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────
// Wrap migrations in a MySQL advisory lock so that when multiple Node replicas
// boot together (Railway rolling restart, horizontal scale) only ONE process
// runs migrations at a time. Others wait briefly and skip when the lock is
// already held, avoiding duplicate ALTER/CREATE races on the same DB.
async function runMigrationsSafely() {
  const LOCK_NAME = "afp_migrations_lock";
  try {
    const { rows } = await pool.query("SELECT GET_LOCK(?, 10) AS got", [LOCK_NAME]);
    const got = rows && rows[0] && Number(rows[0].got) === 1;
    if (!got) {
      console.log("Migrations lock held by another instance — skipping.");
      return;
    }
    try {
      await runMigrations();
    } finally {
      await pool.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    }
  } catch (err) {
    // GET_LOCK is MySQL-specific; if the driver rejects it, fall back to a
    // best-effort direct run so local dev still boots.
    console.warn("Advisory lock unavailable, running migrations directly:", err.message);
    await runMigrations();
  }
}

runMigrationsSafely().then(() => {
  app.listen(PORT, () => {
    console.log(`AFP API listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error("Migration failed, starting anyway:", err.message);
  app.listen(PORT, () => {
    console.log(`AFP API listening on port ${PORT}`);
  });
});

module.exports = app;
