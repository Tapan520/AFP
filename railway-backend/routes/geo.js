// ─────────────────────────────────────────────────────────────────────────────
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
const crypto  = require("crypto");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// ── HTTP cache helper for public geo reads ───────────────────────────────────
// Cities / nigams / zones / wards change rarely, so we hand out:
//   • Cache-Control: public, max-age=300, stale-while-revalidate=86400
//     ↳ Browser & CDN cache for 5 min, serve stale for a day while revalidating.
//   • ETag: strong SHA-1 hash of the response body → cheap 304 replies.
// The mobile Expo app just sets `If-None-Match` on every request and gets a
// 304 with zero body when nothing changed, keeping the geo tree offline-friendly.
function sendCached(res, req, rows, { maxAge = 300, swr = 86400 } = {}) {
  const body = JSON.stringify(rows);
  const etag = 'W/"' + crypto.createHash("sha1").update(body).digest("base64") + '"';
  res.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${swr}`);
  res.set("ETag", etag);
  res.set("Vary", "Accept-Encoding");
  const inm = req.headers["if-none-match"];
  if (inm && inm === etag) {
    return res.status(304).end();
  }
  res.type("application/json").send(body);
}

// ── Public read routes ────────────────────────────────────────────────────────

// GET /api/geo/cities
router.get("/cities", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, state FROM cities WHERE is_active = TRUE ORDER BY name"
    );
    // Cities change rarely — cache for an hour, tolerate a week of staleness.
    return sendCached(res, req, rows, { maxAge: 3600, swr: 604800 });
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
    return sendCached(res, req, rows, { maxAge: 600, swr: 604800 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/nigams/:id — single nigam public read (used by the payment page
// to look up per-nigam fees just before creating a Razorpay order).
// NOTE: this route MUST be declared AFTER `/nigams/all` (defined below), or
// Express will match "/all" against ":id" first and return 404. To keep both
// working we register this handler with an explicit numeric-id guard.
router.get("/nigams/:id(\\d+)", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, city_id, registration_fee, renewal_fee, transfer_fee,
              fees_updated_at, is_active
         FROM nigams WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Nigam not found." });
    // Short cache so a fee change propagates within a minute for the payment
    // page but repeat opens of the renew form don't hammer the DB.
    return sendCached(res, req, rows[0], { maxAge: 60, swr: 3600 });
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
    return sendCached(res, req, rows, { maxAge: 600, swr: 604800 });
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
    return sendCached(res, req, rows, { maxAge: 600, swr: 604800 });
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
// Editable by:
//   • super_admin — any nigam
//   • nigam_admin — only their own nigam (caller.nigam_id === :id)
// Fee bounds are enforced server-side and every fee change is:
//   • stamped on the nigams row     (fees_updated_at, fees_updated_by)
//   • appended to nigam_fee_history (one row per changed field)
// so both an "at-a-glance" audit and a full time-series are available.
const FEE_MIN = 0;
const FEE_MAX = 10_000;

function _validateFee(label, raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (n < FEE_MIN || n > FEE_MAX) {
    return { ok: false, error: `${label} must be between \u20B9${FEE_MIN} and \u20B9${FEE_MAX}.` };
  }
  // Round to 2 decimals (paise precision).
  return { ok: true, value: Math.round(n * 100) / 100 };
}

router.put("/nigams/:id(\\d+)", authenticate, async (req, res) => {
  const caller  = req.user;
  const nigamId = parseInt(req.params.id, 10);
  if (!Number.isInteger(nigamId)) {
    return res.status(400).json({ error: "Invalid nigam id." });
  }

  // Authorisation: super_admin OR nigam_admin whose own nigam matches
  const isSuper = caller.role === "super_admin";
  const isOwnNigamAdmin =
    caller.role === "nigam_admin" && caller.nigam_id && caller.nigam_id === nigamId;
  if (!isSuper && !isOwnNigamAdmin) {
    return res.status(403).json({ error: "You cannot edit this nigam." });
  }

  const { name, is_active, registration_fee, renewal_fee, transfer_fee } = req.body || {};

  // nigam_admin cannot change the nigam name or its active flag — only fees.
  if (!isSuper && (name !== undefined || is_active !== undefined)) {
    return res.status(403).json({
      error: "Nigam admins can only update fees, not the nigam name or active flag.",
    });
  }

  // Validate fee values (skip fields that were not supplied)
  const rf = _validateFee("Registration fee", registration_fee);
  if (!rf.ok) return res.status(400).json({ error: rf.error });
  const rn = _validateFee("Renewal fee", renewal_fee);
  if (!rn.ok) return res.status(400).json({ error: rn.error });
  const tf = _validateFee("Transfer fee", transfer_fee);
  if (!tf.ok) return res.status(400).json({ error: tf.error });

  try {
    // Fetch current values so we can detect real changes for the audit log.
    const { rows: cur } = await pool.query(
      `SELECT id, registration_fee, renewal_fee, transfer_fee
         FROM nigams WHERE id = $1`,
      [nigamId]
    );
    if (!cur.length) return res.status(404).json({ error: "Nigam not found." });
    const before = cur[0];

    // Compare which fees actually changed
    const feeChanges = [];
    const eq = (a, b) => a != null && b != null && Number(a) === Number(b);
    if (rf.value != null && !eq(before.registration_fee, rf.value)) {
      feeChanges.push({ field: "registration_fee", old: before.registration_fee, new: rf.value });
    }
    if (rn.value != null && !eq(before.renewal_fee, rn.value)) {
      feeChanges.push({ field: "renewal_fee", old: before.renewal_fee, new: rn.value });
    }
    if (tf.value != null && !eq(before.transfer_fee, tf.value)) {
      feeChanges.push({ field: "transfer_fee", old: before.transfer_fee, new: tf.value });
    }

    // Apply the update
    const { rows } = await pool.query(
      `UPDATE nigams SET
         name             = COALESCE($1, name),
         is_active        = COALESCE($2, is_active),
         registration_fee = COALESCE($3, registration_fee),
         renewal_fee      = COALESCE($4, renewal_fee),
         transfer_fee     = COALESCE($5, transfer_fee),
         fees_updated_at  = CASE WHEN $6 > 0 THEN NOW()  ELSE fees_updated_at END,
         fees_updated_by  = CASE WHEN $6 > 0 THEN $7     ELSE fees_updated_by END
       WHERE id = $8 RETURNING *`,
      [
        name?.trim() || null,
        is_active ?? null,
        rf.value,
        rn.value,
        tf.value,
        feeChanges.length,
        caller.id,
        nigamId,
      ]
    );

    // Append per-field history rows
    for (const c of feeChanges) {
      try {
        await pool.query(
          `INSERT INTO nigam_fee_history (nigam_id, field, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [nigamId, c.field, c.old, c.new, caller.id]
        );
      } catch (err) {
        // History failure must not block the primary update — log & continue.
        console.error("nigam_fee_history insert failed:", err.message);
      }
    }

    res.json({ ...rows[0], fee_changes: feeChanges.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/geo/nigams/:id/fee-history — last 100 fee changes, most recent first.
// Readable by super_admin, or by the nigam_admin whose own nigam matches.
router.get("/nigams/:id(\\d+)/fee-history", authenticate, async (req, res) => {
  const caller  = req.user;
  const nigamId = parseInt(req.params.id, 10);
  if (!Number.isInteger(nigamId)) {
    return res.status(400).json({ error: "Invalid nigam id." });
  }
  const isSuper = caller.role === "super_admin";
  const isOwnNigamAdmin =
    caller.role === "nigam_admin" && caller.nigam_id && caller.nigam_id === nigamId;
  if (!isSuper && !isOwnNigamAdmin) {
    return res.status(403).json({ error: "Not allowed." });
  }
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.changed_at,
              h.changed_by, u.name AS changed_by_name
         FROM nigam_fee_history h
         LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.nigam_id = $1
         ORDER BY h.changed_at DESC
         LIMIT 100`,
      [nigamId]
    );
    res.json(rows);
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

// ── Admin delete routes (super_admin only) ───────────────────────────────────
// Deletes are guarded by DB FK constraints; child rows must be removed first.

function _friendlyChildErr(err, level) {
  const msg = (err && err.message) || "";
  const isFk = err && (err.code === "23503" || err.errno === 1451 || /foreign key/i.test(msg));
  if (isFk) {
    const hint = {
      city:  "Delete or reassign its nigams first.",
      nigam: "Delete or reassign its zones first.",
      zone:  "Delete or reassign its wards first.",
      ward:  "Reassign or delete users/pets attached to this ward first.",
    }[level] || "Remove dependent records first.";
    return { status: 409, error: `Cannot delete ${level}: it still has related records. ${hint}` };
  }
  return { status: 500, error: msg || `Failed to delete ${level}.` };
}

// DELETE /api/geo/cities/:id
router.delete("/cities/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM cities WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "City not found." });
    res.json({ message: "City deleted.", id: +req.params.id });
  } catch (err) {
    const e = _friendlyChildErr(err, "city");
    res.status(e.status).json({ error: e.error });
  }
});

// DELETE /api/geo/nigams/:id
router.delete("/nigams/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM nigams WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Nigam not found." });
    res.json({ message: "Nigam deleted.", id: +req.params.id });
  } catch (err) {
    const e = _friendlyChildErr(err, "nigam");
    res.status(e.status).json({ error: e.error });
  }
});

// DELETE /api/geo/zones/:id
router.delete("/zones/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM zones WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Zone not found." });
    res.json({ message: "Zone deleted.", id: +req.params.id });
  } catch (err) {
    const e = _friendlyChildErr(err, "zone");
    res.status(e.status).json({ error: e.error });
  }
});

// DELETE /api/geo/wards/:id
router.delete("/wards/:id", authenticate, requireRole("super_admin"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM wards WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Ward not found." });
    res.json({ message: "Ward deleted.", id: +req.params.id });
  } catch (err) {
    const e = _friendlyChildErr(err, "ward");
    res.status(e.status).json({ error: e.error });
  }
});

module.exports = router;
