// ?????????????????????????????????????????????????????????????????????????????
// routes/shops.js
//
// GET    /api/shops          - public list (cityId / q filters)
// POST   /api/shops          - create (super_admin)
// PUT    /api/shops/:id      - update (super_admin)
// DELETE /api/shops/:id      - delete (super_admin)
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

const SHOP_SELECT = `
  SELECT
    s.*,
    c.name AS city_name,
    n.name AS nigam_name,
    z.name AS zone_name,
    w.ward_number,
    COALESCE(rt.avg_stars, 0)   AS average_rating,
    COALESCE(rt.rating_count, 0) AS rating_count
  FROM shops s
  LEFT JOIN cities c ON c.id = s.city_id
  LEFT JOIN nigams n ON n.id = s.nigam_id
  LEFT JOIN zones  z ON z.id = s.zone_id
  LEFT JOIN wards  w ON w.id = s.ward_id
  LEFT JOIN (
    SELECT target_id,
           AVG(stars)  AS avg_stars,
           COUNT(*)    AS rating_count
      FROM ratings
     WHERE target_type = 'shop'
     GROUP BY target_id
  ) rt ON rt.target_id = s.id
`;

// ?? GET /api/shops  (public) or /api/admin/shops  (admin sees inactive too)
// Same rating aggregate + ?sortBy=rating|name convention as /api/doctors.
router.get("/", async (req, res) => {
  const { cityId, q } = req.query;
  const sortBy = (req.query.sortBy || "rating").toLowerCase();
  const params = [];
  const isAdmin = (req.baseUrl || "").includes("/admin");
  const where  = isAdmin ? [] : [
    "s.is_active = TRUE",
    // Same 30-day grace as doctors above. Legacy rows with NULL expiry stay
    // visible so pre-pipeline listings don't vanish.
    "(s.licence_expiry_date IS NULL OR s.licence_expiry_date > DATE_SUB(NOW(), INTERVAL 30 DAY))",
  ];

  if (cityId) { params.push(cityId); where.push(`s.city_id = $${params.length}`); }
  if (q?.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(
      `(s.name ILIKE $${params.length} OR s.owner_name ILIKE $${params.length} OR s.speciality ILIKE $${params.length})`
    );
  }

  const orderSQL = sortBy === "name"
    ? "ORDER BY s.name ASC"
    : "ORDER BY (COALESCE(rt.rating_count,0) = 0) ASC, COALESCE(rt.avg_stars,0) DESC, s.name ASC";

  // Pagination (same bounds as /api/doctors).
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10)  || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${SHOP_SELECT} ${whereSQL} ${orderSQL} LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PATCH /api/shops/:id/active  { is_active } ???????????????????????????????
router.patch("/:id/active", authenticate, requireRole("super_admin"), async (req, res) => {
  const { is_active } = req.body;
  if (typeof is_active !== "boolean") {
    return res.status(400).json({ error: "is_active (boolean) is required." });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE shops SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id",
      [is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Shop not found." });
    res.json({ message: is_active ? "Enabled." : "Disabled.", id: rows[0].id, is_active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? POST /api/shops ???????????????????????????????????????????????????????????
router.post("/", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, ownerName, address, mobile, timings, speciality, cityId, nigamId, zoneId, wardId } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: "name and mobile are required." });
  try {
    const { rows } = await pool.query(
      `INSERT INTO shops (name,owner_name,address,mobile,timings,speciality,city_id,nigam_id,zone_id,ward_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [name, ownerName||null, address||null, mobile, timings||null, speciality||null,
       cityId||null, nigamId||null, zoneId||null, wardId||null]
    );
    const { rows: [shop] } = await pool.query(`${SHOP_SELECT} WHERE s.id = $1`, [rows[0].id]);
    res.status(201).json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PUT /api/shops/:id ????????????????????????????????????????????????????????
router.put("/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, ownerName, address, mobile, timings, speciality, cityId, nigamId, zoneId, wardId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE shops SET
         name       = COALESCE($1,  name),
         owner_name = COALESCE($2,  owner_name),
         address    = COALESCE($3,  address),
         mobile     = COALESCE($4,  mobile),
         timings    = COALESCE($5,  timings),
         speciality = COALESCE($6,  speciality),
         city_id    = COALESCE($7,  city_id),
         nigam_id   = COALESCE($8,  nigam_id),
         zone_id    = COALESCE($9,  zone_id),
         ward_id    = COALESCE($10, ward_id),
         updated_at = NOW()
       WHERE id = $11 RETURNING id`,
      [name||null, ownerName||null, address||null, mobile||null,
       timings||null, speciality||null,
       cityId||null, nigamId||null, zoneId||null, wardId||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Shop not found." });
    const { rows: [shop] } = await pool.query(`${SHOP_SELECT} WHERE s.id = $1`, [req.params.id]);
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? DELETE /api/shops/:id ?????????????????????????????????????????????????????
router.delete("/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM shops WHERE id = $1 RETURNING id", [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Shop not found." });
    res.json({ message: "Deleted.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
