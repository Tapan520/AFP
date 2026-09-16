// ─────────────────────────────────────────────────────────────────────────────
// routes/adminAuditLogs.js  -  Super-admin activity / audit logs
//
// GET    /api/admin/audit-logs           - paginated + filtered list
//        query: q, action, userId, from (YYYY-MM-DD), to (YYYY-MM-DD),
//               page, pageSize
// DELETE /api/admin/audit-logs/:id       - delete a single log entry
// DELETE /api/admin/audit-logs           - bulk delete by ids or by date range
//        body: { ids?: number[], from?: date, to?: date, all?: bool }
//
// All routes require super_admin.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, requireRole("super_admin"));

// Helper (also exported) – append a row into activity_logs. Never throws so
// callers can log without try/catch cluttering their handler code.
async function logActivity(userId, action, details, req) {
  try {
    const ip =
      (req?.headers?.["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req?.socket?.remoteAddress ||
      null;
    const ua = req?.headers?.["user-agent"] || null;
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, details || null, ip, ua]
    );
  } catch (err) {
    console.error("logActivity failed:", err.message);
  }
}

// GET /api/admin/audit-logs
router.get("/", async (req, res) => {
  const where  = [];
  const params = [];
  const { q, action, userId, from, to } = req.query;

  if (action) { params.push(action); where.push(`al.action = $${params.length}`); }
  if (userId) { params.push(+userId); where.push(`al.user_id = $${params.length}`); }
  if (from)   { params.push(from);   where.push(`DATE(al.created_at) >= $${params.length}`); }
  if (to)     { params.push(to);     where.push(`DATE(al.created_at) <= $${params.length}`); }
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.mobile ILIKE $${params.length} OR al.details ILIKE $${params.length} OR al.action ILIKE $${params.length})`);
  }
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize, 10) || 25));
  const offset   = (page - 1) * pageSize;

  try {
    const countParams = params.slice();
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${whereSQL}`,
      countParams
    );

    const listParams = params.slice();
    listParams.push(pageSize);
    listParams.push(offset);
    const { rows } = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.details, al.ip_address, al.user_agent, al.created_at,
              u.name AS user_name, u.mobile AS user_mobile, u.email AS user_email, u.role AS user_role
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${whereSQL}
         ORDER BY al.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    res.json({ rows, total: +total || 0, page, pageSize });
  } catch (err) {
    console.error("GET /admin/audit-logs error:", err.message);
    res.status(500).json({ error: "Failed to load audit logs." });
  }
});

// DELETE /api/admin/audit-logs/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM activity_logs WHERE id = $1",
      [+req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Log entry not found." });
    await logActivity(req.user.id, "audit.log_deleted", `Deleted log id=${req.params.id}`, req);
    res.json({ message: "Deleted.", id: +req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/audit-logs   { ids?, from?, to?, all? }
router.delete("/", async (req, res) => {
  const { ids, from, to, all } = req.body || {};
  try {
    let deleted = 0;
    if (Array.isArray(ids) && ids.length) {
      const nums = ids.map(x => +x).filter(Number.isInteger);
      if (!nums.length) return res.status(400).json({ error: "No valid ids." });
      const ph = nums.map((_, i) => `$${i + 1}`).join(",");
      const { rowCount } = await pool.query(
        `DELETE FROM activity_logs WHERE id IN (${ph})`, nums
      );
      deleted = rowCount || 0;
    } else if (from || to) {
      const where = [];
      const p = [];
      if (from) { p.push(from); where.push(`DATE(created_at) >= $${p.length}`); }
      if (to)   { p.push(to);   where.push(`DATE(created_at) <= $${p.length}`); }
      const { rowCount } = await pool.query(
        `DELETE FROM activity_logs WHERE ${where.join(" AND ")}`, p
      );
      deleted = rowCount || 0;
    } else if (all === true) {
      const { rowCount } = await pool.query(`DELETE FROM activity_logs`);
      deleted = rowCount || 0;
    } else {
      return res.status(400).json({ error: "Provide ids, from/to, or all=true." });
    }
    await logActivity(req.user.id, "audit.logs_purged", `Deleted ${deleted} log rows`, req);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.logActivity = logActivity;
