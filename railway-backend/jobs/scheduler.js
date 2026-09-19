// ─────────────────────────────────────────────────────────────────────────────
// jobs/scheduler.js — Background cron jobs.
//
// Runs inside the same Node process as the API. Guarded so it starts only
// once per boot (matters when the server module is required more than once,
// e.g. from tests). Uses `node-cron` which is already declared in package.json.
//
// Jobs:
//   1. Nightly (02:15 IST) sweep of business_applications:
//        • rows in draft / docs_uploaded older than 90 days AND never paid
//          → status = 'expired'  (soft-delete; row is preserved for audit).
//   2. Weekly (Mon 09:00 IST) renewal reminder emails for doctors/shops whose
//      licence expires in the next 30 days.
// ─────────────────────────────────────────────────────────────────────────────

let _started = false;

function start(pool, sendEmail) {
  if (_started) return;
  _started = true;

  let cron;
  try { cron = require("node-cron"); }
  catch (err) {
    console.warn(`⚠ node-cron unavailable — scheduled jobs disabled: ${err.message}`);
    return;
  }

  const TZ = process.env.CRON_TZ || "Asia/Kolkata";

  // ── 1. Nightly abandoned-application sweep ───────────────────────────────
  // Runs at 02:15 every day. Marks rows that never made it past docs_uploaded
  // AND are >= 90 days old as 'expired'. Approved / rejected / paid rows are
  // untouched. Idempotent — running twice in the same night is safe.
  cron.schedule("15 2 * * *", async () => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE business_applications
            SET status = 'expired', updated_at = NOW()
          WHERE status IN ('draft', 'docs_uploaded')
            AND payment_id IS NULL
            AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`
      );
      if (rowCount > 0) {
        console.log(`[cron] Expired ${rowCount} abandoned business application(s).`);
      }
    } catch (err) {
      console.error(`[cron] abandoned-sweep failed: ${err.message}`);
    }
  }, { timezone: TZ });

  // ── 2. Weekly renewal reminders ──────────────────────────────────────────
  // Runs Monday 09:00. Emails applicants whose listing expires in the next
  // 30 days. We track which listings we've already reminded via a small
  // helper table (created lazily) so we don't spam owners weekly.
  cron.schedule("0 9 * * 1", async () => {
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS business_renewal_reminders (
           listing_type VARCHAR(10) NOT NULL,
           listing_id   INTEGER     NOT NULL,
           bucket       VARCHAR(10) NOT NULL,
           sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (listing_type, listing_id, bucket)
         )`
      );

      const rows = (await pool.query(
        `SELECT 'doctor' AS type, d.id, d.name, d.licence_expiry_date,
                DATEDIFF(d.licence_expiry_date, CURDATE()) AS days_to_expiry,
                u.email, u.name AS applicant_name
           FROM doctors d
           JOIN business_applications ba ON ba.id = d.source_application_id
           JOIN users u ON u.id = ba.applicant_id
          WHERE d.licence_expiry_date IS NOT NULL
            AND d.licence_expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            AND u.email IS NOT NULL
          UNION ALL
         SELECT 'shop' AS type, s.id, s.name, s.licence_expiry_date,
                DATEDIFF(s.licence_expiry_date, CURDATE()) AS days_to_expiry,
                u.email, u.name AS applicant_name
           FROM shops s
           JOIN business_applications ba ON ba.id = s.source_application_id
           JOIN users u ON u.id = ba.applicant_id
          WHERE s.licence_expiry_date IS NOT NULL
            AND s.licence_expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            AND u.email IS NOT NULL`
      )).rows;

      let sent = 0;
      for (const r of rows) {
        const days   = Number(r.days_to_expiry);
        const bucket = days <= 7 ? "7d" : "30d";
        // Skip if already reminded for this bucket
        const { rows: seen } = await pool.query(
          `SELECT 1 FROM business_renewal_reminders
            WHERE listing_type = $1 AND listing_id = $2 AND bucket = $3`,
          [r.type, r.id, bucket]
        );
        if (seen.length) continue;
        await sendEmail({
          to:      r.email,
          subject: `⏰ ${r.name} — renewal due in ${days} day${days === 1 ? "" : "s"}`,
          text:
`Hi ${r.applicant_name || "there"},

Your ${r.type === "doctor" ? "veterinary" : "pet-shop"} listing "${r.name}" on the All For Pets directory expires on ${r.licence_expiry_date}.

Please renew from the /RegisterBusiness page to stay visible to citizens.

— All For Pets`,
        });
        await pool.query(
          `INSERT INTO business_renewal_reminders (listing_type, listing_id, bucket)
                VALUES ($1,$2,$3)`,
          [r.type, r.id, bucket]
        );
        sent++;
      }
      if (sent > 0) console.log(`[cron] Sent ${sent} renewal reminder(s).`);
    } catch (err) {
      console.error(`[cron] renewal-reminder failed: ${err.message}`);
    }
  }, { timezone: TZ });

  console.log(`✔ Background jobs scheduled (TZ=${TZ}): abandoned-sweep, renewal-reminders`);
}

module.exports = { start };
