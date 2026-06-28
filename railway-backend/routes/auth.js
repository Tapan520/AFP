// ?????????????????????????????????????????????????????????????????????????????
// routes/auth.js  -  POST /api/auth/register  +  POST /api/auth/login
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const pool    = require("../db");

const router = express.Router();

// ?? helpers ??????????????????????????????????????????????????????????????????
function makeToken(user) {
  return jwt.sign(
    {
      id:       user.id,
      role:     user.role,
      city_id:  user.city_id,
      nigam_id: user.nigam_id,
      zone_id:  user.zone_id,
      ward_id:  user.ward_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const USER_SELECT = `
  SELECT
    u.id, u.name, u.mobile, u.email, u.address, u.role,
    u.city_id,  c.name  AS city_name,
    u.nigam_id, n.name  AS nigam_name,
    u.zone_id,  z.name  AS zone_name,
    u.ward_id,  w.ward_number,
    u.is_active, u.created_at
  FROM users u
  LEFT JOIN cities c ON c.id = u.city_id
  LEFT JOIN nigams n ON n.id = u.nigam_id
  LEFT JOIN zones  z ON z.id = u.zone_id
  LEFT JOIN wards  w ON w.id = u.ward_id
`;

// ?? POST /api/auth/register ???????????????????????????????????????????????????
router.post("/register", async (req, res) => {
  const { name, mobile, email, password, address, cityId, nigamId, zoneId, wardId } =
    req.body;

  if (!name || !mobile || !password) {
    return res.status(400).json({ error: "name, mobile and password are required." });
  }
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: "Invalid mobile number." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, mobile, email, password_hash, address, role, city_id, nigam_id, zone_id, ward_id)
       VALUES ($1,$2,$3,$4,$5,'citizen',$6,$7,$8,$9)
       RETURNING id`,
      [name, mobile, email || null, hash, address || null,
       cityId || null, nigamId || null, zoneId || null, wardId || null]
    );
    const { rows: [user] } = await pool.query(
      `${USER_SELECT} WHERE u.id = $1`, [rows[0].id]
    );
    return res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Mobile number already registered." });
    }
    console.error("register error:", err.message);
    return res.status(500).json({ error: "Registration failed." });
  }
});

// ?? POST /api/auth/login ??????????????????????????????????????????????????????
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier and password are required." });
  }

  try {
    const { rows } = await pool.query(
      `${USER_SELECT}
       WHERE (u.mobile = $1 OR u.email = $1)
         AND u.is_active = TRUE`,
      [identifier]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const { rows: [{ password_hash }] } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1", [user.id]
    );
    const ok = await bcrypt.compare(password, password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    return res.json({ token: makeToken(user), user });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Login failed." });
  }
});

module.exports = router;
