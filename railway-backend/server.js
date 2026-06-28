// ?????????????????????????????????????????????????????????????????????????????
// server.js  -  AllForPets Municipal Portal  -  Express API for Railway
// ?????????????????????????????????????????????????????????????????????????????
require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const pool       = require("./db");

// ?? Route modules ?????????????????????????????????????????????????????????????
const authRouter        = require("./routes/auth");
const geoRouter         = require("./routes/geo");
const petsRouter        = require("./routes/pets");
const adminUsersRouter  = require("./routes/adminUsers");
const doctorsRouter     = require("./routes/doctors");
const shopsRouter       = require("./routes/shops");
const reportsRouter     = require("./routes/reports");
const discussionsRouter = require("./routes/discussions");

const app  = express();
const PORT = process.env.PORT || 3000;

// ?? CORS ??????????????????????????????????????????????????????????????????????
// Allow the .NET frontend origin plus local development
const allowedOrigins = [
  process.env.CORS_ORIGIN,
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
// Files saved by multer to ./uploads/pets/ are served here without auth.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ?? Health check ??????????????????????????????????????????????????????????????
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: "error", db: err.message });
  }
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

// Doctors  (public GET + super_admin write)
app.use("/api/doctors", doctorsRouter);

// Shops  (public GET + super_admin write)
app.use("/api/shops", shopsRouter);

// Reports
app.use("/api/reports", reportsRouter);


// Community Forum discussions
app.use("/api/discussions", discussionsRouter);
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
  ];
  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error("Migration warning:", err.message);
    }
  }
  console.log("Migrations applied.");
}

// ?? Start ?????????????????????????????????????????????????????????????????????
runMigrations().then(() => {
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
