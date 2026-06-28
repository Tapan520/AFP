// ?????????????????????????????????????????????????????????????????????????????
// routes/doctors.js
//
// GET    /api/doctors             - public list (with cityId / q filters)
// GET    /api/admin/doctors       - admin list (geo-filtered, with nigamId/wardId)
// POST   /api/doctors             - create (super_admin)
// PUT    /api/doctors/:id         - update (super_admin)
// DELETE /api/doctors/:id         - delete (super_admin)
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

const DOC_SELECT = `
  SELECT
    d.*,
    c.name AS city_name,
    n.name AS nigam_name,
    z.name AS zone_name,
    w.ward_number
  FROM doctors d
  LEFT JOIN cities c ON c.id = d.city_id
  LEFT JOIN nigams n ON n.id = d.nigam_id
  LEFT JOIN zones  z ON z.id = d.zone_id
  LEFT JOIN wards  w ON w.id = d.ward_id
`;

// ?? GET /api/doctors  (public) ????????????????????????????????????????????????
router.get("/", async (req, res) => {
  const { cityId, q } = req.query;
  const params = [];
  const where  = ["d.is_active = TRUE"];

  if (cityId) { params.push(cityId); where.push(`d.city_id = $${params.length}`); }
  if (q?.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(
      `(d.name ILIKE $${params.length} OR d.clinic_name ILIKE $${params.length} OR d.specialization ILIKE $${params.length})`
    );
  }

  try {
    const { rows } = await pool.query(
      `${DOC_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.name LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? POST /api/doctors ?????????????????????????????????????????????????????????
router.post("/", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, qualification, specialization, clinicName, address, mobile,
          timings, is24hr, cityId, nigamId, zoneId, wardId } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: "name and mobile are required." });
  try {
    const { rows } = await pool.query(
      `INSERT INTO doctors
         (name,qualification,specialization,clinic_name,address,mobile,timings,is_24hr,city_id,nigam_id,zone_id,ward_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [name, qualification||null, specialization||null, clinicName||null,
       address||null, mobile, timings||null, !!is24hr,
       cityId||null, nigamId||null, zoneId||null, wardId||null]
    );
    const { rows: [doc] } = await pool.query(`${DOC_SELECT} WHERE d.id = $1`, [rows[0].id]);
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PUT /api/doctors/:id ??????????????????????????????????????????????????????
router.put("/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, qualification, specialization, clinicName, address, mobile,
          timings, is24hr, cityId, nigamId, zoneId, wardId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE doctors SET
         name           = COALESCE($1,  name),
         qualification  = COALESCE($2,  qualification),
         specialization = COALESCE($3,  specialization),
         clinic_name    = COALESCE($4,  clinic_name),
         address        = COALESCE($5,  address),
         mobile         = COALESCE($6,  mobile),
         timings        = COALESCE($7,  timings),
         is_24hr        = COALESCE($8,  is_24hr),
         city_id        = COALESCE($9,  city_id),
         nigam_id       = COALESCE($10, nigam_id),
         zone_id        = COALESCE($11, zone_id),
         ward_id        = COALESCE($12, ward_id),
         updated_at     = NOW()
       WHERE id = $13 RETURNING id`,
      [name||null, qualification||null, specialization||null, clinicName||null,
       address||null, mobile||null, timings||null,
       is24hr !== undefined ? !!is24hr : null,
       cityId||null, nigamId||null, zoneId||null, wardId||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Doctor not found." });
    const { rows: [doc] } = await pool.query(`${DOC_SELECT} WHERE d.id = $1`, [req.params.id]);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? DELETE /api/doctors/:id ???????????????????????????????????????????????????
router.delete("/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM doctors WHERE id = $1 RETURNING id", [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Doctor not found." });
    res.json({ message: "Deleted.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
