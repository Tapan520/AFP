// ?????????????????????????????????????????????????????????????????????????????
// routes/reports.js
//
// POST /api/reports  - submit a report (authenticated citizen)
// GET  /api/reports  - view reports scoped to caller's ward/zone/nigam/city
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/reports  - ward_admin+ view reports scoped to their ward/zone/nigam/city
router.get("/", authenticate, requireRole("ward_admin"), async (req, res) => {
  const caller = req.user;
  const base = `
    SELECT r.id, r.report_type, r.last_seen_address, r.reporter_mobile,
           r.status, r.created_at, r.ward_id,
           u.name AS reporter_name,
           w.ward_number
    FROM reports r
    LEFT JOIN users u ON r.reporter_id = u.id
    LEFT JOIN wards w ON r.ward_id = w.id
  `;
  try {
    let query = base;
    let params = [];
    if (caller.role === "ward_admin" && caller.ward_id) {
      query += ` WHERE r.ward_id = $1 ORDER BY r.created_at DESC`;
      params = [caller.ward_id];
    } else if (caller.role === "zone_admin" && caller.zone_id) {
      query += ` WHERE r.zone_id = $1 ORDER BY r.created_at DESC`;
      params = [caller.zone_id];
    } else if (caller.role === "nigam_admin" && caller.nigam_id) {
      query += ` WHERE r.nigam_id = $1 ORDER BY r.created_at DESC`;
      params = [caller.nigam_id];
    } else if (caller.role === "city_admin" && caller.city_id) {
      query += ` WHERE r.city_id = $1 ORDER BY r.created_at DESC`;
      params = [caller.city_id];
    } else {
      // super_admin sees all
      query += ` ORDER BY r.created_at DESC`;
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports  - authenticated citizen submits a report
router.post("/", authenticate, async (req, res) => {
  const { reportType, lastSeenAddress, reporterMobile } = req.body;
  if (!reportType) return res.status(400).json({ error: "reportType is required." });
  try {
    // Fetch the reporter's geo info so it is stored directly on the report row.
    // This makes ward-scoped filtering in GET reliable regardless of future
    // changes to the user's profile.
    const { rows: [reporter] } = await pool.query(
      `SELECT city_id, nigam_id, zone_id, ward_id FROM users WHERE id = $1`,
      [req.user.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO reports
         (reporter_id, reporter_mobile, report_type, last_seen_address,
          city_id, nigam_id, zone_id, ward_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.user.id,
        reporterMobile || null,
        reportType,
        lastSeenAddress || null,
        reporter?.city_id  || null,
        reporter?.nigam_id || null,
        reporter?.zone_id  || null,
        reporter?.ward_id  || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/:id/comments  - ward_admin+ fetches all comments for a report
router.get("/:id/comments", authenticate, requireRole("ward_admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rc.id, rc.comment, rc.created_at, rc.updated_at,
              u.name AS admin_name, u.role AS admin_role
       FROM report_comments rc
       JOIN users u ON rc.admin_id = u.id
       WHERE rc.report_id = $1
       ORDER BY rc.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/:id/comments  - ward_admin+ adds a new comment to a report
router.post("/:id/comments", authenticate, requireRole("ward_admin"), async (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "comment is required." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO report_comments (report_id, admin_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id, comment, created_at, updated_at`,
      [req.params.id, req.user.id, comment.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reports/:id/comments/:cid  - ward_admin+ updates their own comment
router.put("/:id/comments/:cid", authenticate, requireRole("ward_admin"), async (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "comment is required." });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE report_comments
         SET comment = $1, updated_at = NOW()
       WHERE id = $2 AND report_id = $3 AND admin_id = $4
       RETURNING id, comment, created_at, updated_at`,
      [comment.trim(), req.params.cid, req.params.id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Comment not found or not owned by you." });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reports/:id/resolve  - ward_admin+ closes/resolves a report
router.patch("/:id/resolve", authenticate, requireRole("ward_admin"), async (req, res) => {
  const { note } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE reports
         SET status = 'resolved', resolution_note = $1, resolved_at = NOW(), resolved_by = $2
       WHERE id = $3
       RETURNING *`,
      [note || null, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Report not found." });
    res.json(rows[0]);
  } catch (err) {
    // If the extra columns don't exist yet, fall back to updating only status
    try {
      const { rows } = await pool.query(
        `UPDATE reports SET status = 'resolved' WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Report not found." });
      res.json(rows[0]);
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

module.exports = router;
