// ─────────────────────────────────────────────────────────────────────────────
// routes/ratings.js — Pet-owner feedback / ratings for Doctors & Shops
//
// A pet owner (citizen) can rate any published Doctor or Shop from ONE simple
// screen — no need to open the target's profile page. Only the LATEST rating
// per (user, target_type, target_id) is kept: the UNIQUE index enforces that
// and the POST endpoint upserts (INSERT ... ON DUPLICATE KEY UPDATE).
//
// GET    /api/ratings/targets?type=doctor|shop[&q=]  → list rateable targets
//                                                     with avg + own rating
// GET    /api/ratings/mine                           → my ratings (both types)
// POST   /api/ratings                                → upsert {type,id,stars,comment}
// DELETE /api/ratings/:id                            → remove own rating
// ─────────────────────────────────────────────────────────────────────────────
const express          = require("express");
const pool             = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

const VALID_TYPES = new Set(["doctor", "shop"]);

// ── GET /api/ratings/targets ────────────────────────────────────────────────
// Returns the list of doctors OR shops (active only) with average rating,
// total rating count, and — when the caller has rated it — their own stars
// & comment so the UI can prefill the form.
router.get("/targets", authenticate, async (req, res) => {
  const type = String(req.query.type || "").toLowerCase();
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "type must be 'doctor' or 'shop'." });
  }
  const table = type === "doctor" ? "doctors" : "shops";
  const q     = (req.query.q || "").trim();

  const params = [type, req.user.id];
  let where = "t.is_active = TRUE";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (t.name ILIKE $${params.length} OR t.mobile ILIKE $${params.length})`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.name, t.mobile, t.address,
         c.name       AS city_name,
         w.ward_number AS ward_number,
         ${type === "doctor" ? "t.clinic_name, t.specialization," : "t.owner_name, t.speciality,"}
         COALESCE(agg.avg_stars, 0)::float AS avg_stars,
         COALESCE(agg.rating_count, 0)::int AS rating_count,
         mine.stars   AS my_stars,
         mine.comment AS my_comment,
         mine.id      AS my_rating_id,
         mine.updated_at AS my_updated_at
       FROM ${table} t
       LEFT JOIN cities c ON c.id = t.city_id
       LEFT JOIN wards  w ON w.id = t.ward_id
       LEFT JOIN (
         SELECT target_id,
                AVG(stars)   AS avg_stars,
                COUNT(*)     AS rating_count
         FROM ratings
         WHERE target_type = $1
         GROUP BY target_id
       ) agg ON agg.target_id = t.id
       LEFT JOIN ratings mine
              ON mine.target_type = $1
             AND mine.target_id   = t.id
             AND mine.user_id     = $2
       WHERE ${where}
       ORDER BY t.name ASC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /ratings/targets error:", err.message);
    res.status(500).json({ error: "Failed to load rateable targets." });
  }
});

// ── GET /api/ratings/mine ───────────────────────────────────────────────────
router.get("/mine", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              CASE WHEN r.target_type = 'doctor' THEN d.name ELSE s.name END AS target_name
         FROM ratings r
         LEFT JOIN doctors d ON r.target_type = 'doctor' AND d.id = r.target_id
         LEFT JOIN shops   s ON r.target_type = 'shop'   AND s.id = r.target_id
        WHERE r.user_id = $1
        ORDER BY r.updated_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /ratings/mine error:", err.message);
    res.status(500).json({ error: "Failed to load your ratings." });
  }
});

// ── POST /api/ratings ───────────────────────────────────────────────────────
// Upsert — the UNIQUE (user_id, target_type, target_id) index guarantees only
// the LATEST rating per (owner, target) survives.
router.post("/", authenticate, async (req, res) => {
const { targetType, targetId, stars, comment } = req.body || {};
const type = String(targetType || "").toLowerCase();
const id   = Number(targetId);
const s    = Number(stars);

if (!VALID_TYPES.has(type))          return res.status(400).json({ error: "targetType must be 'doctor' or 'shop'." });
if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "targetId is required." });
if (!Number.isInteger(s) || s < 1 || s > 5)
  return res.status(400).json({ error: "stars must be an integer between 1 and 5." });

  const table = type === "doctor" ? "doctors" : "shops";
  const trimmedComment = comment ? String(comment).trim().slice(0, 1000) : null;

  try {
    // Confirm the target exists & is active — silently prevents rating deleted rows.
    const { rows: [target] } = await pool.query(
      `SELECT id FROM ${table} WHERE id = $1 AND is_active = TRUE`, [id]
    );
    if (!target) return res.status(404).json({ error: "Target not found." });

    // MySQL-native upsert. The db.js shim only translates
    // `ON CONFLICT ... DO NOTHING` (→ INSERT IGNORE); `ON CONFLICT ... DO UPDATE`
    // + `EXCLUDED.*` is left untouched and MySQL rejects it as a syntax error,
    // so we use `ON DUPLICATE KEY UPDATE ... VALUES(col)` instead. The unique
    // index idx_ratings_user_target(user_id, target_type, target_id) enforces
    // "one rating per (user, target)" that makes this behave like an upsert.
    await pool.query(
      `INSERT INTO ratings (user_id, target_type, target_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON DUPLICATE KEY UPDATE stars      = VALUES(stars),
                               comment    = VALUES(comment),
                               updated_at = NOW()`,
      [req.user.id, type, id, s, trimmedComment]
    );

    const { rows: [saved] } = await pool.query(
      `SELECT * FROM ratings
        WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [req.user.id, type, id]
    );
    res.status(201).json(saved);
  } catch (err) {
    console.error("POST /ratings error:", err.code || "", err.message);
    if (err.stack) console.error(err.stack);
    // Surface the real error so the UI toast is diagnostic instead of a
    // generic "Failed to save rating." message.
    res.status(500).json({ error: `Failed to save rating: ${err.message}` });
  }
});

// ── GET /api/ratings/admin ──────────────────────────────────────────────────
// Admin browse of ALL citizen ratings. Optional filters:
//   ?type=doctor|shop   ?stars=1..5   ?q=<name-or-comment substring>
//   ?limit=200 (max 500)
// Access: ward_admin and above. No geo-scoping — ratings are portal-wide.
router.get("/admin", authenticate, requireRole("ward_admin"), async (req, res) => {
  const params = [];
  const where  = [];
  if (VALID_TYPES.has(req.query.type)) {
    params.push(req.query.type);
    where.push(`r.target_type = $${params.length}`);
  }
  const stars = parseInt(req.query.stars, 10);
  if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
    params.push(stars);
    where.push(`r.stars = $${params.length}`);
  }
  const q = (req.query.q || "").trim();
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(u.name ILIKE ${p} OR r.comment ILIKE ${p}
                 OR d.name ILIKE ${p} OR s.name ILIKE ${p})`);
  }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.target_type, r.target_id, r.stars, r.comment,
              r.created_at, r.updated_at,
              u.name   AS reviewer_name,
              u.mobile AS reviewer_mobile,
              CASE WHEN r.target_type = 'doctor' THEN d.name ELSE s.name END AS target_name,
              CASE WHEN r.target_type = 'doctor' THEN d.mobile ELSE s.mobile END AS target_mobile
         FROM ratings r
         LEFT JOIN users   u ON u.id = r.user_id
         LEFT JOIN doctors d ON r.target_type = 'doctor' AND d.id = r.target_id
         LEFT JOIN shops   s ON r.target_type = 'shop'   AND s.id = r.target_id
         ${whereSQL}
         ORDER BY r.updated_at DESC
         LIMIT ${limit}`,
      params
    );
    // Summary stats over the FULL table (not just the filtered slice) so
    // the header numbers stay stable while the admin filters.
    const { rows: [sum] } = await pool.query(
      `SELECT COUNT(*)::int                         AS total,
              COALESCE(AVG(stars), 0)::float        AS avg_stars,
              SUM(CASE WHEN target_type='doctor' THEN 1 ELSE 0 END)::int AS doctor_count,
              SUM(CASE WHEN target_type='shop'   THEN 1 ELSE 0 END)::int AS shop_count
         FROM ratings`
    );
    res.json({ summary: sum || { total: 0, avg_stars: 0, doctor_count: 0, shop_count: 0 }, rows });
  } catch (err) {
    console.error("GET /ratings/admin error:", err.message);
    res.status(500).json({ error: "Failed to load ratings." });
  }
});

// ── DELETE /api/ratings/:id ─────────────────────────────────────────────────
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      "SELECT user_id FROM ratings WHERE id = $1", [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "Rating not found." });
    if (existing.user_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "You can only delete your own ratings." });

    await pool.query("DELETE FROM ratings WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted." });
  } catch (err) {
    console.error("DELETE /ratings/:id error:", err.message);
    res.status(500).json({ error: "Failed to delete rating." });
  }
});

module.exports = router;
