// One-time migration: create report_comments table
// Usage (local .env):
//   node migrate-report-comments.js
//
// Usage (against Railway production DB):
//   set DATABASE_URL=postgresql://... && node migrate-report-comments.js
//   -- OR --
//   cross-env DATABASE_URL=postgresql://... node migrate-report-comments.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_comments (
        id         SERIAL      PRIMARY KEY,
        report_id  INTEGER     NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        admin_id   INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        comment    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("? report_comments table ready");

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_report_comments_report_id
        ON report_comments(report_id)
    `);
    console.log("? index idx_report_comments_report_id ready");

    const { rows } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM report_comments
    `);
    console.log(`\nreport_comments rows: ${rows[0].cnt}`);
    console.log("\n? Migration complete.");
  } catch (err) {
    console.error("? Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
