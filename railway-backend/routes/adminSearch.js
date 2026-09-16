// ─────────────────────────────────────────────────────────────────────────────
// routes/adminSearch.js
//
// GET /api/admin/search?q=xxx&limit=5
//
// Cross-searches users, pets, doctors and shops. Requires ward_admin+.
// Results are role-scoped where the underlying table has a geo column, so a
// ward_admin only sees rows within their ward, a city_admin within their city,
// etc. super_admin sees everything.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, requireRole("ward_admin"), async (req, res) => {
  const q     = (req.query.q || "").trim();
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
  if (q.length < 2) return res.json({ users: [], pets: [], doctors: [], shops: [] });
  const like   = `%${q}%`;
  const caller = req.user;

  // Optional geo scope (skip for super_admin). `col` is a table-alias prefix
  // like "p." or "" so the same helper works across all four sub-queries.
  const geoScope = (col) => {
    if (caller.role === "super_admin") return { sql: "", p: [] };
    if (caller.role === "city_admin"  && caller.city_id)  return { sql: ` AND ${col}city_id = $__`,  p: [caller.city_id]  };
    if (caller.role === "nigam_admin" && caller.nigam_id) return { sql: ` AND ${col}nigam_id = $__`, p: [caller.nigam_id] };
    if (caller.role === "zone_admin"  && caller.zone_id)  return { sql: ` AND ${col}zone_id = $__`,  p: [caller.zone_id]  };
    if (caller.role === "ward_admin"  && caller.ward_id)  return { sql: ` AND ${col}ward_id = $__`,  p: [caller.ward_id]  };
    return { sql: "", p: [] };
  };

  async function search(baseSql, prefixedCol, extraParams = []) {
    const scope  = geoScope(prefixedCol);
    const params = [like, like, like, ...extraParams, ...scope.p];
    // Renumber $__ placeholders in scope.sql
    let idx = params.length - scope.p.length;
    const scopeSql = scope.sql.replace(/\$__/g, () => `$${++idx}`);
    params.push(limit);
    const sql = `${baseSql}${scopeSql} ORDER BY 1 LIMIT $${params.length}`;
    try {
      const { rows } = await pool.query(sql, params);
      return rows;
    } catch (err) {
      console.error("global-search sub-query failed:", err.message);
      return [];
    }
  }

  try {
    const [users, pets, doctors, shops] = await Promise.all([
      search(
        `SELECT id, name, mobile, email, role FROM users
         WHERE (name ILIKE $1 OR mobile ILIKE $2 OR email ILIKE $3)`,
        ""
      ),
      search(
        `SELECT p.id, p.name, p.pet_id, p.species, p.registration_status,
                u.name AS owner_name
         FROM pets p LEFT JOIN users u ON u.id = p.owner_id
         WHERE (p.name ILIKE $1 OR p.pet_id ILIKE $2 OR u.name ILIKE $3)`,
        "p."
      ),
      search(
        `SELECT id, name, clinic_name, mobile, specialization FROM doctors
         WHERE (name ILIKE $1 OR clinic_name ILIKE $2 OR mobile ILIKE $3)`,
        ""
      ),
      search(
        `SELECT id, name, owner_name, mobile, speciality FROM shops
         WHERE (name ILIKE $1 OR owner_name ILIKE $2 OR mobile ILIKE $3)`,
        ""
      ),
    ]);
    res.json({ users, pets, doctors, shops });
  } catch (err) {
    console.error("GET /api/admin/search error:", err.message);
    res.status(500).json({ error: "Global search failed." });
  }
});

module.exports = router;
