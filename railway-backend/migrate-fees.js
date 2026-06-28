// One-time migration: add fee columns to nigams table
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

(async () => {
  try {
    await pool.query("ALTER TABLE nigams ADD COLUMN IF NOT EXISTS registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200");
    console.log("? registration_fee column ready");
    await pool.query("ALTER TABLE nigams ADD COLUMN IF NOT EXISTS renewal_fee NUMERIC(10,2) NOT NULL DEFAULT 150");
    console.log("? renewal_fee column ready");
    await pool.query("ALTER TABLE nigams ADD COLUMN IF NOT EXISTS transfer_fee NUMERIC(10,2) NOT NULL DEFAULT 100");
    console.log("? transfer_fee column ready");

    const { rows } = await pool.query(
      "SELECT id, name, registration_fee, renewal_fee, transfer_fee FROM nigams ORDER BY id"
    );
    console.log("\nNigams after migration:");
    rows.forEach(r =>
      console.log(`  [${r.id}] ${r.name} | reg=?${r.registration_fee} renew=?${r.renewal_fee} txn=?${r.transfer_fee}`)
    );
    console.log("\n? Migration complete.");
  } catch (err) {
    console.error("? Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
