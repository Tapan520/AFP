// ?????????????????????????????????????????????????????????????????????????????
// routes/adminAnalytics.js — Municipal analytics dashboard
//
// GET /api/admin/analytics
//   Returns:
//     • cityTrends[]   — pets registered per city per month for the last 12 mo
//     • yoyRevenue[]   — revenue this year vs last year per month
//                         (derived from approved pets × fixed licence fee ?200)
//     • speciesMix{}   — { dog, cat, other } totals scoped to caller
//     • pendingByWard[] — top 10 wards with pending applications
//
// Scoping: honours ward_admin / nigam_admin / city_admin / super_admin.
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

const LICENCE_FEE = 200; // synced with appsettings.Development.json Payment.RegistrationFee

// NOTE: db.js is a MySQL pool with a PostgreSQL-compatible shim. It rewrites
// $N placeholders to ?, translates ILIKE, COUNT(*) FILTER(WHERE ...), etc., but
// it does NOT translate Postgres-only date functions (TO_CHAR / date_trunc /
// EXTRACT / INTERVAL '12 months'). All SQL below therefore uses MySQL-native
// date functions while keeping the pg-style $N placeholders + { rows } result
// shape that the shim exposes.

function _scope(caller) {
  const where  = [];
  const params = [];
  if (caller.role === "ward_admin"  && caller.ward_id)       { params.push(caller.ward_id);  where.push(`p.ward_id  = $${params.length}`); }
  else if (caller.role === "nigam_admin" && caller.nigam_id) { params.push(caller.nigam_id); where.push(`p.nigam_id = $${params.length}`); }
  else if (caller.role === "city_admin"  && caller.city_id)  { params.push(caller.city_id);  where.push(`p.city_id  = $${params.length}`); }
  return { whereSQL: where.length ? "AND " + where.join(" AND ") : "", params };
}

router.get("/", authenticate, requireRole("ward_admin"), async (req, res) => {
  try {
    const { whereSQL, params } = _scope(req.user);

    // ── City trends (last 12 months, per city) ─────────────────────────────
    const cityTrends = (await pool.query(
      `SELECT c.name AS city,
              DATE_FORMAT(p.created_at, '%Y-%m') AS month,
              COUNT(*) AS count
       FROM pets p
       LEFT JOIN cities c ON c.id = p.city_id
       WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
         ${whereSQL}
       GROUP BY c.name, DATE_FORMAT(p.created_at, '%Y-%m')
       ORDER BY month ASC, c.name ASC`,
      params
    )).rows;

    // ── YoY revenue (current year vs previous year, monthly) ───────────────
    const yoyRevenue = (await pool.query(
      `SELECT YEAR(p.created_at)  AS year,
              MONTH(p.created_at) AS month,
              COUNT(*)            AS approved_count,
              (COUNT(*) * $${params.length + 1}) AS revenue
       FROM pets p
       WHERE p.registration_status = 'approved'
         AND p.created_at >= DATE_SUB(MAKEDATE(YEAR(NOW()), 1), INTERVAL 1 YEAR)
         ${whereSQL}
       GROUP BY YEAR(p.created_at), MONTH(p.created_at)
       ORDER BY year, month`,
      [...params, LICENCE_FEE]
    )).rows;

    // ── Species mix ────────────────────────────────────────────────────────
    // Use SUM(CASE ...) directly. The db.js shim's FILTER(WHERE ...) regex
    // cannot handle conditions that themselves contain parentheses like
    // NOT IN ('dog','cat').
    const speciesMix = (await pool.query(
      `SELECT
         SUM(CASE WHEN p.species = 'dog' THEN 1 ELSE 0 END) AS dog,
         SUM(CASE WHEN p.species = 'cat' THEN 1 ELSE 0 END) AS cat,
         SUM(CASE WHEN p.species NOT IN ('dog','cat') THEN 1 ELSE 0 END) AS other
       FROM pets p
       WHERE p.registration_status = 'approved'
         ${whereSQL}`,
      params
    )).rows[0] || { dog: 0, cat: 0, other: 0 };

    // ── Pending by ward (top 10) ──────────────────────────────────────────
    const pendingByWard = (await pool.query(
      `SELECT w.ward_number AS ward, c.name AS city, COUNT(*) AS pending
       FROM pets p
       LEFT JOIN wards  w ON w.id = p.ward_id
       LEFT JOIN cities c ON c.id = p.city_id
       WHERE p.registration_status = 'pending'
         ${whereSQL}
       GROUP BY w.ward_number, c.name
       ORDER BY pending DESC
       LIMIT 10`,
      params
    )).rows;

    res.json({ cityTrends, yoyRevenue, speciesMix, pendingByWard, licenceFee: LICENCE_FEE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
