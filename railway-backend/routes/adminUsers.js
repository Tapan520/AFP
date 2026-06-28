﻿// ?????????????????????????????????????????????????????????????????????????????
// routes/adminUsers.js
//
// GET    /api/admin/users          - list users (filtered, role-scoped)
// POST   /api/admin/users          - create user
// PUT    /api/admin/users/:id      - update user
// DELETE /api/admin/users/:id      - delete user
//
// Access: ward_admin and above (authenticate + requireRole("ward_admin"))
// Role-based scope enforcement is done inside each handler.
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const bcrypt  = require("bcryptjs");
const pool    = require("../db");
const { authenticate, requireRole, manageableRoles } = require("../middleware/auth");

const router = express.Router();

// All routes require a valid JWT from a staff account (ward_admin or above)
router.use(authenticate, requireRole("ward_admin"));

// ?? Shared SELECT with geo joins ??????????????????????????????????????????????
const USER_SELECT = `
  SELECT
    u.id,
    u.name,
    u.mobile,
    u.email,
    u.address,
    u.role,
    u.city_id,   c.name   AS city_name,
    u.nigam_id,  n.name   AS nigam_name,
    u.zone_id,   z.name   AS zone_name,
    u.ward_id,   w.ward_number,
    u.is_active,
    u.created_at,
    u.updated_at
  FROM users u
  LEFT JOIN cities c ON c.id = u.city_id
  LEFT JOIN nigams n ON n.id = u.nigam_id
  LEFT JOIN zones  z ON z.id = u.zone_id
  LEFT JOIN wards  w ON w.id = u.ward_id
`;

// ?? GET /api/admin/users ??????????????????????????????????????????????????????
// Query params:
//   role    - filter by role (citizen|ward_admin|nigam_admin|city_admin|super_admin)
//   cityId  - filter by city
//   nigamId - filter by nigam
//   wardId  - filter by ward
//   q       - search by name, mobile or email (ILIKE)
// ?????????????????????????????????????????????????????????????????????????????
router.get("/", async (req, res) => {
  const caller   = req.user;
  const allowed  = manageableRoles(caller.role);
  const { role, cityId, nigamId, zoneId, wardId, q } = req.query;

  // Validate requested role is within caller's allowed set
  if (role && !allowed.includes(role)) {
    return res.status(403).json({ error: "You cannot view users with that role." });
  }

  const params = [];
  const where  = [];

  // Scope: only roles the caller can manage
  if (role) {
    params.push(role);
    where.push(`u.role = $${params.length}`);
  } else {
    params.push(allowed);
    where.push(`u.role = ANY($${params.length}::text[])`);
  }

  // Geo scope enforcement (non-super_admin callers are bounded to their geo)
  if (caller.role !== "super_admin") {
    if (caller.city_id) {
      params.push(caller.city_id);
      where.push(`u.city_id = $${params.length}`);
    }
    if (caller.role === "nigam_admin" && caller.nigam_id) {
      params.push(caller.nigam_id);
      where.push(`u.nigam_id = $${params.length}`);
    }
    if (["zone_admin"].includes(caller.role) && caller.zone_id) {
      params.push(caller.zone_id);
      where.push(`u.zone_id = $${params.length}`);
    }
    if (caller.role === "ward_admin" && caller.ward_id) {
      params.push(caller.ward_id);
      where.push(`u.ward_id = $${params.length}`);
    }
  }

  // Optional caller-supplied extra filters
  if (cityId && caller.role === "super_admin") {
    params.push(cityId);
    where.push(`u.city_id = $${params.length}`);
  }
  if (nigamId && ["super_admin","city_admin"].includes(caller.role)) {
    params.push(nigamId);
    where.push(`u.nigam_id = $${params.length}`);
  }
  if (zoneId && ["super_admin","city_admin","nigam_admin"].includes(caller.role)) {
    params.push(zoneId);
    where.push(`u.zone_id = $${params.length}`);
  }
  if (wardId && ["super_admin","city_admin","nigam_admin"].includes(caller.role)) {
    params.push(wardId);
    where.push(`u.ward_id = $${params.length}`);
  }

  // Text search
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(
      `(u.name ILIKE $${params.length} OR u.mobile ILIKE $${params.length} OR u.email ILIKE $${params.length})`
    );
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `${USER_SELECT} ${whereSQL} ORDER BY u.created_at DESC LIMIT 200`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error("GET /admin/users error:", err.message);
    return res.status(500).json({ error: "Failed to fetch users." });
  }
});

// ?? POST /api/admin/users ?????????????????????????????????????????????????????
// Body: { name, mobile, email?, address?, role, cityId?, nigamId?, wardId?, password, is_active? }
// ?????????????????????????????????????????????????????????????????????????????
router.post("/", async (req, res) => {
  const caller = req.user;
  const allowed = manageableRoles(caller.role);

  const {
    name, mobile, email, address, role,
    cityId, nigamId, zoneId, wardId,
    password, is_active = true,
  } = req.body;

  // ?? Validation ??????????????????????????????????????????
  if (!name || !mobile || !role || !password) {
    return res.status(400).json({ error: "name, mobile, role and password are required." });
  }
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: "Invalid mobile number." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (!allowed.includes(role)) {
    return res.status(403).json({ error: `You cannot create a user with role '${role}'.` });
  }

  // ?? Geo scope guard ??????????????????????????????????????
  // If caller is not super_admin, resolve geo from caller's own scope
  const resolvedCityId  = caller.role === "super_admin" ? (cityId  || null) : (caller.city_id  || cityId  || null);
  const resolvedNigamId = caller.role === "super_admin" ? (nigamId || null) : (caller.nigam_id || nigamId || null);
  const resolvedZoneId  = caller.role === "super_admin" ? (zoneId  || null) : (caller.zone_id  || zoneId  || null);
  const resolvedWardId  = ["ward_admin","zone_admin"].includes(caller.role) ? (caller.ward_id || wardId || null) : (wardId || null);

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users
         (name, mobile, email, password_hash, address, role, city_id, nigam_id, zone_id, ward_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        name.trim(),
        mobile.trim(),
        email?.trim() || null,
        hash,
        address?.trim() || null,
        role,
        resolvedCityId  ? +resolvedCityId  : null,
        resolvedNigamId ? +resolvedNigamId : null,
        resolvedZoneId  ? +resolvedZoneId  : null,
        resolvedWardId  ? +resolvedWardId  : null,
        is_active !== false,
      ]
    );

    const { rows: [user] } = await pool.query(
      `${USER_SELECT} WHERE u.id = $1`, [rows[0].id]
    );
    return res.status(201).json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Mobile number already registered." });
    }
    console.error("POST /admin/users error:", err.message);
    return res.status(500).json({ error: "Failed to create user." });
  }
});

// ?? PUT /api/admin/users/:id ??????????????????????????????????????????????????
// Body: { name?, mobile?, email?, address?, role?, cityId?, nigamId?, wardId?, password?, is_active? }
// ?????????????????????????????????????????????????????????????????????????????
router.put("/:id", async (req, res) => {
  const caller  = req.user;
  const allowed = manageableRoles(caller.role);
  const userId  = parseInt(req.params.id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  // Fetch existing user to validate scope
  const { rows: existing } = await pool.query(
    "SELECT id, role, city_id, nigam_id, ward_id FROM users WHERE id = $1",
    [userId]
  );
  if (!existing.length) {
    return res.status(404).json({ error: "User not found." });
  }
  const target = existing[0];

  // Ensure caller can manage this user's current role
  if (!allowed.includes(target.role)) {
    return res.status(403).json({ error: "You cannot edit this user." });
  }

  const {
    name, mobile, email, address, role,
    cityId, nigamId, zoneId, wardId,
    password, is_active,
  } = req.body;

  // If role is being changed, ensure caller can assign the new role too
  if (role && !allowed.includes(role)) {
    return res.status(403).json({ error: `You cannot assign role '${role}'.` });
  }

  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: "Invalid mobile number." });
  }
  if (password && password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    // Build dynamic SET clause
    const sets   = [];
    const params = [];

    if (name     !== undefined) { params.push(name.trim());          sets.push(`name = $${params.length}`); }
    if (mobile   !== undefined) { params.push(mobile.trim());        sets.push(`mobile = $${params.length}`); }
    if (email    !== undefined) { params.push(email?.trim() || null); sets.push(`email = $${params.length}`); }
    if (address  !== undefined) { params.push(address?.trim()||null); sets.push(`address = $${params.length}`); }
    if (role     !== undefined) { params.push(role);                  sets.push(`role = $${params.length}`); }
    if (cityId   !== undefined) { params.push(cityId  ? +cityId  : null); sets.push(`city_id = $${params.length}`); }
    if (nigamId  !== undefined) { params.push(nigamId ? +nigamId : null); sets.push(`nigam_id = $${params.length}`); }
    if (zoneId   !== undefined) { params.push(zoneId  ? +zoneId  : null); sets.push(`zone_id = $${params.length}`); }
    if (wardId   !== undefined) { params.push(wardId  ? +wardId  : null); sets.push(`ward_id = $${params.length}`); }
    if (is_active!== undefined) { params.push(is_active !== false);   sets.push(`is_active = $${params.length}`); }
    if (password)               {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash);
      sets.push(`password_hash = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }

    // always update updated_at
    sets.push(`updated_at = NOW()`);
    params.push(userId);

    await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );

    const { rows: [user] } = await pool.query(
      `${USER_SELECT} WHERE u.id = $1`, [userId]
    );
    return res.json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Mobile number already in use." });
    }
    console.error("PUT /admin/users/:id error:", err.message);
    return res.status(500).json({ error: "Failed to update user." });
  }
});

// ?? DELETE /api/admin/users/:id ???????????????????????????????????????????????
router.delete("/:id", async (req, res) => {
  const caller  = req.user;
  const allowed = manageableRoles(caller.role);
  const userId  = parseInt(req.params.id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  // Prevent self-deletion
  if (userId === caller.id) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }

  const { rows: existing } = await pool.query(
    "SELECT id, role FROM users WHERE id = $1", [userId]
  );
  if (!existing.length) {
    return res.status(404).json({ error: "User not found." });
  }
  if (!allowed.includes(existing[0].role)) {
    return res.status(403).json({ error: "You cannot delete this user." });
  }

  try {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    return res.json({ message: "User deleted successfully.", id: userId });
  } catch (err) {
    console.error("DELETE /admin/users/:id error:", err.message);
    return res.status(500).json({ error: "Failed to delete user." });
  }
});

module.exports = router;
