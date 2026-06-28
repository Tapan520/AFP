﻿// ─────────────────────────────────────────────────────────────────────────────
// routes/geo.js  -  City -> Nigam -> Zone -> Ward
//
// Public  GET /api/geo/cities          - all active cities
// Public  GET /api/geo/nigams          - ?cityId=
// Public  GET /api/geo/zones           - ?nigamId=
// Public  GET /api/geo/wards           - ?zoneId= (or ?nigamId= fallback)
// Admin   GET /api/geo/cities/all      - with counts  (super_admin)
// Admin   GET /api/geo/nigams/all      - with counts  (super_admin)
// Admin   GET /api/geo/zones/all       - with counts  (super_admin)
// Admin   GET /api/geo/wards/all       - with counts  (super_admin)
// Admin   POST/PUT for all four levels (super_admin)
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// ── Public read routes ────────────────────────────────────────────────────────

// GET /api/geo/cities
router.get("/cities", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, state FROM cities WHERE is_active = TRUE ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/nigams?cityId=
router.get("/nigams", async (req, res) => {
  const { cityId } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, city_id, registration_fee, renewal_fee, transfer_fee FROM nigams
       WHERE is_active = TRUE ${cityId ? "AND city_id = $1" : ""}
       ORDER BY name`,
      cityId ? [cityId] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/zones?nigamId=
router.get("/zones", async (req, res) => {
  const { nigamId } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, nigam_id FROM zones
       WHERE is_active = TRUE ${nigamId ? "AND nigam_id = $1" : ""}
       ORDER BY name`,
      nigamId ? [nigamId] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/wards?zoneId=  (also accepts ?nigamId= for backward compat)
router.get("/wards", async (req, res) => {
  const { zoneId, nigamId } = req.query;
  try {
    let query, params;
    if (zoneId) {
      query  = "SELECT id, ward_number, zone_id, nigam_id FROM wards WHERE is_active = TRUE AND zone_id = $1 ORDER BY ward_number";
      params = [zoneId];
    } else if (nigamId) {
      // Backward-compat: wards that belong to zones inside this nigam
      query  = `SELECT w.id, w.ward_number, w.zone_id, w.nigam_id
                FROM wards w
                LEFT JOIN zones z ON z.id = w.zone_id
                WHERE w.is_active = TRUE
                  AND (w.nigam_id = $1 OR z.nigam_id = $1)
                ORDER BY w.ward_number`;
      params = [nigamId];
    } else {
      query  = "SELECT id, ward_number, zone_id, nigam_id FROM wards WHERE is_active = TRUE ORDER BY ward_number";
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin read routes (with counts) ──────────────────────────────────────────

// GET /api/geo/cities/all
router.get("/cities/all", authenticate, requireRole("super_admin"), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.state, c.is_active,
        COUNT(DISTINCT n.id)::int  AS nigam_count,
        COUNT(DISTINCT z.id)::int  AS zone_count,
        COUNT(DISTINCT w.id)::int  AS ward_count,
        COUNT(DISTINCT p.id)::int  AS pet_count
      FROM cities c
      LEFT JOIN nigams n ON n.city_id  = c.id
      LEFT JOIN zones  z ON z.nigam_id = n.id
      LEFT JOIN wards  w ON w.zone_id  = z.id
      LEFT JOIN pets   p ON p.city_id  = c.id
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/nigams/all?cityId=
router.get("/nigams/all", authenticate, requireRole("super_admin"), async (req, res) => {
  const { cityId } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         n.id, n.name, n.city_id, n.is_active,
         n.registration_fee, n.renewal_fee, n.transfer_fee,
         COUNT(DISTINCT z.id)::int AS zone_count,
         COUNT(DISTINCT w.id)::int AS ward_count
       FROM nigams n
       LEFT JOIN zones z ON z.nigam_id = n.id
       LEFT JOIN wards w ON w.zone_id  = z.id
       ${cityId ? "WHERE n.city_id = $1" : ""}
       GROUP BY n.id
       ORDER BY n.name`,
      cityId ? [cityId] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/zones/all?nigamId=
router.get("/zones/all", authenticate, requireRole("super_admin"), async (req, res) => {
  const { nigamId } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT
         z.id, z.name, z.nigam_id, z.is_active,
         COUNT(DISTINCT w.id)::int AS ward_count,
         COUNT(DISTINCT p.id)::int AS pet_count
       FROM zones z
       LEFT JOIN wards w ON w.zone_id = z.id
       LEFT JOIN pets  p ON p.zone_id = z.id
       ${nigamId ? "WHERE z.nigam_id = $1" : ""}
       GROUP BY z.id
       ORDER BY z.name`,
      nigamId ? [nigamId] : []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/wards/all?zoneId=  (also accepts ?nigamId=)
router.get("/wards/all", authenticate, requireRole("super_admin"), async (req, res) => {
  const { zoneId, nigamId } = req.query;
  try {
    let query, params;
    if (zoneId) {
      query  = `SELECT w.id, w.ward_number, w.zone_id, w.nigam_id, w.is_active,
                       COUNT(DISTINCT p.id)::int AS pet_count
                FROM wards w
                LEFT JOIN pets p ON p.ward_id = w.id
                WHERE w.zone_id = $1
                GROUP BY w.id ORDER BY w.ward_number`;
      params = [zoneId];
    } else if (nigamId) {
      query  = `SELECT w.id, w.ward_number, w.zone_id, w.nigam_id, w.is_active,
                       COUNT(DISTINCT p.id)::int AS pet_count
                FROM wards w
                LEFT JOIN zones z ON z.id = w.zone_id
                LEFT JOIN pets  p ON p.ward_id = w.id
                WHERE w.nigam_id = $1 OR z.nigam_id = $1
                GROUP BY w.id ORDER BY w.ward_number`;
      params = [nigamId];
    } else {
      query  = `SELECT w.id, w.ward_number, w.zone_id, w.nigam_id, w.is_active,
                       COUNT(DISTINCT p.id)::int AS pet_count
                FROM wards w
                LEFT JOIN pets p ON p.ward_id = w.id
                GROUP BY w.id ORDER BY w.ward_number`;
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin write routes ────────────────────────────────────────────────────────

// POST /api/geo/cities
router.post("/cities", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, state } = req.body;
  if (!name) return res.status(400).json({ error: "name is required." });
  try {
    const { rows } = await pool.query(
      "INSERT INTO cities (name, state) VALUES ($1,$2) RETURNING *",
      [name.trim(), state?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/geo/cities/:id
router.put("/cities/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, state, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE cities SET
         name      = COALESCE($1, name),
         state     = COALESCE($2, state),
         is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [name?.trim()||null, state?.trim()||null, is_active??null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "City not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/geo/nigams
router.post("/nigams", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, cityId, registration_fee, renewal_fee, transfer_fee } = req.body;
  if (!name || !cityId) return res.status(400).json({ error: "name and cityId are required." });
  try {
    const { rows } = await pool.query(
      `INSERT INTO nigams (name, city_id, registration_fee, renewal_fee, transfer_fee)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), +cityId,
       registration_fee != null ? +registration_fee : 200,
       renewal_fee      != null ? +renewal_fee      : 150,
       transfer_fee     != null ? +transfer_fee     : 100]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/geo/nigams/:id
router.put("/nigams/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, is_active, registration_fee, renewal_fee, transfer_fee } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE nigams SET
         name             = COALESCE($1, name),
         is_active        = COALESCE($2, is_active),
         registration_fee = COALESCE($3, registration_fee),
         renewal_fee      = COALESCE($4, renewal_fee),
         transfer_fee     = COALESCE($5, transfer_fee)
       WHERE id = $6 RETURNING *`,
      [name?.trim()||null, is_active??null,
       registration_fee != null ? +registration_fee : null,
       renewal_fee      != null ? +renewal_fee      : null,
       transfer_fee     != null ? +transfer_fee     : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Nigam not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/geo/zones
router.post("/zones", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, nigamId } = req.body;
  if (!name || !nigamId) return res.status(400).json({ error: "name and nigamId are required." });
  try {
    const { rows } = await pool.query(
      "INSERT INTO zones (name, nigam_id) VALUES ($1,$2) RETURNING *",
      [name.trim(), +nigamId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/geo/zones/:id
router.put("/zones/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { name, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zones SET
         name      = COALESCE($1, name),
         is_active = COALESCE($2, is_active)
       WHERE id = $3 RETURNING *`,
      [name?.trim()||null, is_active??null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Zone not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/geo/wards
router.post("/wards", authenticate, requireRole("super_admin"), async (req, res) => {
  const { wardNumber, zoneId, nigamId } = req.body;
  if (!wardNumber || (!zoneId && !nigamId))
    return res.status(400).json({ error: "wardNumber and zoneId (or nigamId) are required." });
  try {
    const { rows } = await pool.query(
      "INSERT INTO wards (ward_number, zone_id, nigam_id) VALUES ($1,$2,$3) RETURNING *",
      [wardNumber.trim(), zoneId ? +zoneId : null, nigamId ? +nigamId : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/geo/wards/:id
router.put("/wards/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  const { wardNumber, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE wards SET
         ward_number = COALESCE($1, ward_number),
         is_active   = COALESCE($2, is_active)
       WHERE id = $3 RETURNING *`,
      [wardNumber?.trim()||null, is_active??null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ward not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
