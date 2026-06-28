// ?????????????????????????????????????????????????????????????????????????????
// routes/discussions.js  –  Community Discussion Forum
//
// GET    /api/discussions                       – list threads (category/search)
// POST   /api/discussions                       – create thread          (auth)
// GET    /api/discussions/:id                   – thread + replies       (auth)
// PUT    /api/discussions/:id                   – edit own thread        (auth)
// DELETE /api/discussions/:id                   – delete own thread      (auth)
// POST   /api/discussions/:id/replies           – add reply              (auth)
// PUT    /api/discussions/:id/replies/:rid      – edit own reply         (auth)
// DELETE /api/discussions/:id/replies/:rid      – delete own reply       (auth)
// ?????????????????????????????????????????????????????????????????????????????
const express          = require("express");
const pool             = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

const VALID_CATEGORIES = ["general","health","training","lostfound","nutrition","behaviour","other"];

const THREAD_SELECT = `
  SELECT
    d.*,
    u.name              AS author_name,
    COUNT(r.id)::int    AS reply_count
  FROM discussions d
  LEFT JOIN users              u ON u.id = d.user_id
  LEFT JOIN discussion_replies r ON r.discussion_id = d.id
`;
const THREAD_GROUP = `GROUP BY d.id, u.name`;

// ?? GET /api/discussions ??????????????????????????????????????????????????????
router.get("/", async (req, res) => {
  const { category, q } = req.query;
  const where  = [];
  const params = [];

  if (category && VALID_CATEGORIES.includes(category)) {
    params.push(category);
    where.push(`d.category = $${params.length}`);
  }
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.body ILIKE $${params.length})`);
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `${THREAD_SELECT} ${whereSQL} ${THREAD_GROUP} ORDER BY d.created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /discussions error:", err.message);
    res.status(500).json({ error: "Failed to load discussions." });
  }
});

// ?? POST /api/discussions ?????????????????????????????????????????????????????
router.post("/", authenticate, async (req, res) => {
  const { title, body, category = "general" } = req.body;
  if (!title || !body)    return res.status(400).json({ error: "title and body are required." });
  if (title.length > 200) return res.status(400).json({ error: "Title must be 200 characters or less." });
  if (!VALID_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Invalid category." });

  try {
    const { rows } = await pool.query(
      `INSERT INTO discussions (user_id, title, body, category)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, title.trim(), body.trim(), category]
    );
    const { rows: [thread] } = await pool.query(
      `${THREAD_SELECT} WHERE d.id = $1 ${THREAD_GROUP}`, [rows[0].id]
    );
    res.status(201).json(thread);
  } catch (err) {
    console.error("POST /discussions error:", err.message);
    res.status(500).json({ error: "Failed to create discussion." });
  }
});

// ?? GET /api/discussions/:id ??????????????????????????????????????????????????
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { rows: [thread] } = await pool.query(
      `${THREAD_SELECT} WHERE d.id = $1 ${THREAD_GROUP}`, [req.params.id]
    );
    if (!thread) return res.status(404).json({ error: "Discussion not found." });

    const { rows: replies } = await pool.query(
      `SELECT r.*, u.name AS author_name
       FROM discussion_replies r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.discussion_id = $1
       ORDER BY r.created_at ASC`,
      [req.params.id]
    );
    res.json({ ...thread, replies });
  } catch (err) {
    console.error("GET /discussions/:id error:", err.message);
    res.status(500).json({ error: "Failed to load discussion." });
  }
});

// ?? PUT /api/discussions/:id ??????????????????????????????????????????????????
router.put("/:id", authenticate, async (req, res) => {
  const { title, body } = req.body;
  if (!title && !body) return res.status(400).json({ error: "Nothing to update." });

  try {
    const { rows: [existing] } = await pool.query(
      "SELECT user_id FROM discussions WHERE id = $1", [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "Discussion not found." });
    if (existing.user_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "You can only edit your own posts." });

    await pool.query(
      `UPDATE discussions
       SET title = COALESCE($1, title), body = COALESCE($2, body), updated_at = NOW()
       WHERE id = $3`,
      [title?.trim() || null, body?.trim() || null, req.params.id]
    );
    res.json({ message: "Updated." });
  } catch (err) {
    console.error("PUT /discussions/:id error:", err.message);
    res.status(500).json({ error: "Failed to update discussion." });
  }
});

// ?? DELETE /api/discussions/:id ???????????????????????????????????????????????
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      "SELECT user_id FROM discussions WHERE id = $1", [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "Discussion not found." });
    if (existing.user_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "You can only delete your own posts." });

    await pool.query("DELETE FROM discussions WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted." });
  } catch (err) {
    console.error("DELETE /discussions/:id error:", err.message);
    res.status(500).json({ error: "Failed to delete discussion." });
  }
});

// ?? POST /api/discussions/:id/replies ?????????????????????????????????????????
router.post("/:id/replies", authenticate, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Reply body is required." });

  try {
    const { rows: [disc] } = await pool.query(
      "SELECT id FROM discussions WHERE id = $1", [req.params.id]
    );
    if (!disc) return res.status(404).json({ error: "Discussion not found." });

    const { rows } = await pool.query(
      `INSERT INTO discussion_replies (discussion_id, user_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.params.id, req.user.id, body.trim()]
    );
    const { rows: [reply] } = await pool.query(
      `SELECT r.*, u.name AS author_name
       FROM discussion_replies r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(reply);
  } catch (err) {
    console.error("POST /discussions/:id/replies error:", err.message);
    res.status(500).json({ error: "Failed to post reply." });
  }
});

// ?? PUT /api/discussions/:id/replies/:rid ?????????????????????????????????????
router.put("/:id/replies/:rid", authenticate, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Reply body is required." });

  try {
    const { rows: [existing] } = await pool.query(
      "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2",
      [req.params.rid, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "Reply not found." });
    if (existing.user_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "You can only edit your own replies." });

    await pool.query(
      "UPDATE discussion_replies SET body = $1, updated_at = NOW() WHERE id = $2",
      [body.trim(), req.params.rid]
    );
    res.json({ message: "Updated." });
  } catch (err) {
    console.error("PUT /discussions/:id/replies/:rid error:", err.message);
    res.status(500).json({ error: "Failed to update reply." });
  }
});

// ?? DELETE /api/discussions/:id/replies/:rid ??????????????????????????????????
router.delete("/:id/replies/:rid", authenticate, async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2",
      [req.params.rid, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: "Reply not found." });
    if (existing.user_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "You can only delete your own replies." });

    await pool.query("DELETE FROM discussion_replies WHERE id = $1", [req.params.rid]);
    res.json({ message: "Deleted." });
  } catch (err) {
    console.error("DELETE /discussions/:id/replies/:rid error:", err.message);
    res.status(500).json({ error: "Failed to delete reply." });
  }
});

module.exports = router;
