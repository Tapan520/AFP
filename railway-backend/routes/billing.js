// ─────────────────────────────────────────────────────────────────────────────
// routes/billing.js
//
// GET /api/admin/billing?from=&to=&groupBy=ward|zone|nigam|city
//
// Aggregates pet registrations into billing rows grouped by ward / zone /
// nigam / city. Revenue is estimated from each nigam's `registration_fee`.
//
// Access: ward_admin and above (geo-scoping is not applied here — the summary
// is city-wide; individual rows expose the aggregation dimension only).
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, requireRole("ward_admin"), async (req, res) => {
  const groupBy = ["ward", "zone", "nigam", "city"].includes(req.query.groupBy)
    ? req.query.groupBy : "ward";

  // Default to the last 90 days if no dates supplied.
  const today = new Date();
  const defFrom = new Date(today); defFrom.setDate(today.getDate() - 90);
  const from = req.query.from || defFrom.toISOString().split("T")[0];
  const to   = req.query.to   || today.toISOString().split("T")[0];

  const grpMap = {
    ward:  { col: "w.ward_number", label: "w.ward_number" },
    zone:  { col: "z.name",        label: "z.name"        },
    nigam: { col: "n.name",        label: "n.name"        },
    city:  { col: "c.name",        label: "c.name"        },
  };
  const g = grpMap[groupBy];

  const sql = `
      SELECT
         CAST(${g.label} AS CHAR)                                          AS group_label,
         c.name                                                            AS city_name,
         COUNT(p.id)                                                       AS total,
         SUM(CASE WHEN p.registration_status='approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN p.registration_status='pending'  THEN 1 ELSE 0 END) AS pending,
         COALESCE(SUM(
           CASE WHEN p.registration_status='approved'
                THEN COALESCE(n.registration_fee, 200) ELSE 0 END
         ), 0)                                                             AS estimated_revenue
       FROM pets p
       LEFT JOIN cities c ON c.id = p.city_id
       LEFT JOIN nigams n ON n.id = p.nigam_id
       LEFT JOIN wards  w ON w.id = p.ward_id
       LEFT JOIN zones  z ON z.id = COALESCE(p.zone_id, w.zone_id)
       WHERE DATE(p.created_at) BETWEEN $1 AND $2
       GROUP BY ${g.col}, c.name
       HAVING COUNT(p.id) > 0
       ORDER BY estimated_revenue DESC, total DESC
       LIMIT 200`;

  try {
    const result = await pool.query(sql, [from, to]);
    const rows   = Array.isArray(result) ? result[0] : result.rows;

    const summary = rows.reduce((acc, r) => {
      acc.total    += Number(r.total)    || 0;
      acc.approved += Number(r.approved) || 0;
      acc.pending  += Number(r.pending)  || 0;
      acc.revenue  += Number(r.estimated_revenue) || 0;
      return acc;
    }, { total: 0, approved: 0, pending: 0, revenue: 0 });

    res.json({ from, to, groupBy, summary, rows });
  } catch (err) {
    console.error("GET /api/admin/billing error:", err.message);
    res.status(500).json({
      error:   err.message || "Failed to build billing report.",
      details: err.message,
    });
  }
});

module.exports = router;
