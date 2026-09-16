// ?????????????????????????????????????????????????????????????????????????????
// routes/auth.js  -  POST /api/auth/register  +  POST /api/auth/login
//                    POST /api/auth/refresh   +  GET/PUT /api/auth/me
// ?????????????????????????????????????????????????????????????????????????????
const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const pool    = require("../db");
const { authenticate } = require("../middleware/auth");
const { logActivity } = require("./adminAuditLogs");

const router = express.Router();

// ?? Password policy (shared) ??????????????????????????????????????????????????
// 8+ chars with at least one letter AND one digit.
const PASSWORD_MIN = 8;
const PASSWORD_RE  = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MSG = "Password must be at least 8 characters and include at least one letter and one digit.";
// NOTE: adminUsers.js re-uses validatePassword() below so the 8-char minimum
// applies uniformly to citizen registration AND super-admin user create/update.
function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN || !PASSWORD_RE.test(pw)) return PASSWORD_MSG;
  return null;
}

// ?? Token helpers ????????????????????????????????????????????????????????????
// Short-lived access token (15 min) and longer refresh token.
// remember=true  ? 30 day refresh window
// remember=false ? 1  day refresh window
function makeAccessToken(user) {
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
    { expiresIn: "15m" }
  );
}

// ── Device-bound refresh tokens ───────────────────────────────────────────
// Refresh tokens are now opaque high-entropy strings (base64url of 48 random
// bytes). Each issued token is persisted in `refresh_tokens` as a SHA-256 hash
// alongside device metadata so we can:
//   • List active sessions for the user (GET  /api/auth/sessions)
//   • Revoke one or all sessions       (POST /api/auth/logout, DELETE /sessions/:id)
//   • Rotate on every refresh call (one-shot use → mitigates replay if stolen)
//
// The `expo_push_token` column is set from the mobile app so we can send push
// notifications later without a separate device-registration API.
function generateRefreshTokenString() {
  return crypto.randomBytes(48).toString("base64url");
}
function hashRefreshToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
async function issueRefreshToken(userId, req, remember) {
  const raw  = generateRefreshTokenString();
  const hash = hashRefreshToken(raw);
  const days = remember ? 30 : 1;
  const deviceLabel = (req?.headers?.["x-device-label"] || req?.headers?.["user-agent"] || "unknown").toString().slice(0, 200);
  const expoPush    = (req?.headers?.["x-expo-push-token"] || "").toString().slice(0, 200) || null;
  const ip =
    (req?.headers?.["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req?.socket?.remoteAddress ||
    null;
  try {
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_label, expo_push_token, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, DATE_ADD(NOW(), INTERVAL ${days} DAY))`,
      [userId, hash, deviceLabel, expoPush, ip]
    );
  } catch (err) {
    // If the shim rewrites DATE_ADD strangely, fall back to a JS-computed date.
    const exp = new Date(Date.now() + days * 86400_000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_label, expo_push_token, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, hash, deviceLabel, expoPush, ip, exp]
    );
  }
  return raw;
}

function makeRefreshToken(user, remember) {
  return jwt.sign(
    { id: user.id, typ: "refresh" },
    process.env.JWT_SECRET,
    { expiresIn: remember ? "30d" : "1d" }
  );
}

// Back-compat alias used only in a few places elsewhere in the codebase.
function makeToken(user) { return makeAccessToken(user); }

// ── Per-identifier login lockout (credential-stuffing defence) ───────────────
// The global `/api/auth/*` IP rate limit stops volume attacks, but a slow
// attacker cycling identifiers below that threshold could still succeed.
// This lockout counts failed attempts per (identifier + IP) pair; after
// FAIL_LOCKOUT_MAX failures inside FAIL_LOCKOUT_WINDOW_MS the pair is locked
// for FAIL_LOCKOUT_COOLDOWN_MS. In-process Map is fine at single-instance;
// move to Redis when we scale to multiple Node replicas.
const FAIL_LOCKOUT_MAX          = 5;
const FAIL_LOCKOUT_WINDOW_MS    = 15 * 60_000;   // 15 min
const FAIL_LOCKOUT_COOLDOWN_MS  = 15 * 60_000;   // 15 min
const _loginFails = new Map();                    // key -> { count, first, lockedUntil }

function _loginKey(identifier, req) {
  const ip =
    (req?.headers?.["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req?.socket?.remoteAddress || "unknown";
  return `${(identifier || "").toString().trim().toLowerCase()}|${ip}`;
}
function loginLockoutCheck(identifier, req) {
  const key = _loginKey(identifier, req);
  const rec = _loginFails.get(key);
  if (!rec) return null;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const secs = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    return `Too many failed attempts. Please try again in ${Math.ceil(secs / 60)} minute(s).`;
  }
  return null;
}
function loginLockoutRecordFail(identifier, req) {
  const key   = _loginKey(identifier, req);
  const now   = Date.now();
  const cur   = _loginFails.get(key) || { count: 0, first: now, lockedUntil: 0 };
  // Reset the window if the first failure was long ago.
  if (now - cur.first > FAIL_LOCKOUT_WINDOW_MS) { cur.count = 0; cur.first = now; cur.lockedUntil = 0; }
  cur.count += 1;
  if (cur.count >= FAIL_LOCKOUT_MAX) cur.lockedUntil = now + FAIL_LOCKOUT_COOLDOWN_MS;
  _loginFails.set(key, cur);
}
function loginLockoutRecordSuccess(identifier, req) {
  _loginFails.delete(_loginKey(identifier, req));
}
// Periodic cleanup so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _loginFails) {
    if ((v.lockedUntil || 0) < now && now - v.first > FAIL_LOCKOUT_WINDOW_MS) _loginFails.delete(k);
  }
}, 10 * 60_000).unref?.();

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
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

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
    await logActivity(user.id, "auth.register", `New ${user.role} registered: ${user.name} (${user.mobile})`, req);
    const refreshToken = await issueRefreshToken(user.id, req, false);
    return res.status(201).json({
      token:        makeAccessToken(user),
      refreshToken,
      user,
    });
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
  const { identifier, password, remember } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier and password are required." });
  }

  // Per-identifier + IP lockout guard (in addition to the IP-only rate limit).
  const locked = loginLockoutCheck(identifier, req);
  if (locked) return res.status(429).json({ error: locked });

  try {
    const { rows } = await pool.query(
      `${USER_SELECT}
       WHERE (u.mobile = $1 OR u.email = $1)
         AND u.is_active = TRUE`,
      [identifier]
    );
    const user = rows[0];
    if (!user) {
      loginLockoutRecordFail(identifier, req);
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const { rows: [{ password_hash }] } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1", [user.id]
    );
    const ok = await bcrypt.compare(password, password_hash);
    if (!ok) {
      loginLockoutRecordFail(identifier, req);
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // ?? City status guard for municipal admins ???????????????????????????????
    if (["city_admin", "nigam_admin", "ward_admin"].includes(user.role) && user.city_id) {
      const { rows: [city] } = await pool.query(
        "SELECT is_active FROM cities WHERE id = $1", [user.city_id]
      );
      if (!city || city.is_active === false) {
        return res.status(403).json({ error: "Your City Status is Inactive" });
      }
    }

    // ?? Doctor / Shop status guard ??????????????????????????????????????????
    try {
      const { rows: [doc] } = await pool.query(
        "SELECT is_active FROM doctors WHERE mobile = $1 OR email = $2 LIMIT 1",
        [user.mobile, user.email || null]
      );
      if (doc && doc.is_active === false) {
        return res.status(403).json({
          error: "Your Account Status is Inactive, Please connect with Admin of the Application.",
        });
      }
    } catch { /* doctors table may not have email column � ignore */ }

    try {
      const { rows: [shop] } = await pool.query(
        "SELECT is_active FROM shops WHERE mobile = $1 OR email = $2 LIMIT 1",
        [user.mobile, user.email || null]
      );
      if (shop && shop.is_active === false) {
        return res.status(403).json({
          error: "Your Account Status is Inactive, Please connect with Admin of the Application.",
        });
      }
    } catch { /* shops table may not have email column � ignore */ }

    await logActivity(user.id, "auth.login", `${user.role} logged in: ${user.name} (${user.mobile})`, req);
    loginLockoutRecordSuccess(identifier, req);
    const refreshToken = await issueRefreshToken(user.id, req, !!remember);
    return res.json({
      token:        makeAccessToken(user),
      refreshToken,
      user,
    });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Login failed." });
  }
});

// ?? POST /api/auth/refresh ??????????????????????????????????????????????????
// Body: { refreshToken }
// Strategy:
//   1. Try device-bound path: look up the SHA-256 hash in refresh_tokens.
//      On hit → rotate (delete old, issue new) and return a fresh access token.
//   2. If not found and the token happens to be a legacy JWT with typ="refresh",
//      accept it once (rolling back-compat during the release window).
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "refreshToken required." });

  // --- Path 1: opaque device-bound refresh token ---
  try {
    const hash = hashRefreshToken(refreshToken);
    const { rows } = await pool.query(
      `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens
        WHERE token_hash = $1 LIMIT 1`,
      [hash]
    );
    const row = rows[0];
    if (row && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()) {
      const { rows: [user] } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [row.user_id]);
      if (!user || user.is_active === false) {
        await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [row.id]);
        return res.status(401).json({ error: "User is inactive." });
      }
      // Rotate: delete the used token and issue a new one so replay is impossible.
      const daysLeft = Math.max(1, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 86400_000));
      await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [row.id]);
      const newRaw = await issueRefreshToken(user.id, req, daysLeft > 2);
      return res.json({ token: makeAccessToken(user), refreshToken: newRaw, user });
    }
  } catch (err) {
    console.error("refresh (opaque) error:", err.message);
  }

  // --- Path 2: legacy JWT refresh (back-compat) ---
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (payload.typ !== "refresh") return res.status(401).json({ error: "Invalid refresh token." });
    const { rows: [user] } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [payload.id]);
    if (!user || user.is_active === false) return res.status(401).json({ error: "User is inactive." });
    // Migrate: hand back an opaque token; old JWT continues to work until its own expiry.
    const newRaw = await issueRefreshToken(user.id, req, true);
    return res.json({ token: makeAccessToken(user), refreshToken: newRaw, user });
  } catch {
    return res.status(401).json({ error: "Refresh token expired or invalid. Please log in again." });
  }
});

// ?? POST /api/auth/logout ??????????????????????????????????????????????????
// Body: { refreshToken?, allDevices?: bool }
// - Passing `refreshToken` revokes only that device's token.
// - Passing `allDevices: true` (requires access-token auth) revokes every
//   refresh token for the caller — useful for "Sign out of all devices".
router.post("/logout", async (req, res) => {
  const { refreshToken, allDevices } = req.body || {};
  try {
    if (allDevices) {
      // Require a valid access token so we know who's asking.
      const header = req.headers.authorization || "";
      const access = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!access) return res.status(401).json({ error: "Access token required for global logout." });
      let payload;
      try { payload = jwt.verify(access, process.env.JWT_SECRET); }
      catch { return res.status(401).json({ error: "Invalid access token." }); }
      const { rowCount } = await pool.query(
        "DELETE FROM refresh_tokens WHERE user_id = $1", [payload.id]
      );
      await logActivity(payload.id, "auth.logout_all", `Revoked ${rowCount || 0} sessions`, req);
      return res.json({ revoked: rowCount || 0 });
    }
    if (refreshToken) {
      const hash = hashRefreshToken(refreshToken);
      const { rowCount } = await pool.query(
        "DELETE FROM refresh_tokens WHERE token_hash = $1", [hash]
      );
      return res.json({ revoked: rowCount || 0 });
    }
    return res.status(400).json({ error: "refreshToken or allDevices=true required." });
  } catch (err) {
    console.error("logout error:", err.message);
    return res.status(500).json({ error: "Logout failed." });
  }
});

// ?? GET /api/auth/sessions ????????????????????????????????????????????????
// Returns the caller's active refresh-token sessions (device list) so a
// "Manage devices" screen can show them and let the user revoke any.
router.get("/sessions", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, device_label, ip_address, created_at, last_used_at, expires_at
         FROM refresh_tokens
        WHERE user_id = $1 AND (revoked_at IS NULL) AND expires_at > NOW()
        ORDER BY COALESCE(last_used_at, created_at) DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? DELETE /api/auth/sessions/:id ??????????????????????????????????????????
// Revoke a specific session belonging to the caller.
router.delete("/sessions/:id", authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM refresh_tokens WHERE id = $1 AND user_id = $2",
      [+req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Session not found." });
    res.json({ revoked: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/auth/me ????????????????????????????????????????????????????????
// Returns the current authenticated user's full profile row (with geo names).
router.get("/me", authenticate, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found." });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ?? PUT /api/auth/me ????????????????????????????????????????????????????????
// Body: { name?, mobile?, email?, address?, currentPassword?, newPassword? }
// Any staff/citizen can update their own profile. Password change requires
// the current password to be provided.
router.put("/me", authenticate, async (req, res) => {
  const uid = req.user.id;
  const { name, mobile, email, address, currentPassword, newPassword } = req.body || {};

  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: "Invalid mobile number." });
  }

  try {
    // If a password change is requested, verify current password first.
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: "Current password is required to set a new one." });
      const pwErr = validatePassword(newPassword);
      if (pwErr) return res.status(400).json({ error: pwErr });
      const { rows: [row] } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [uid]);
      if (!row) return res.status(404).json({ error: "User not found." });
      const ok = await bcrypt.compare(currentPassword, row.password_hash);
      if (!ok) return res.status(401).json({ error: "Current password is incorrect." });
    }

    const sets = [];
    const params = [];
    if (name    !== undefined) { params.push(String(name).trim());          sets.push(`name = $${params.length}`); }
    if (mobile  !== undefined) { params.push(String(mobile).trim());        sets.push(`mobile = $${params.length}`); }
    if (email   !== undefined) { params.push((email || "").trim() || null); sets.push(`email = $${params.length}`); }
    if (address !== undefined) { params.push((address||"").trim() || null); sets.push(`address = $${params.length}`); }
    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 10);
      params.push(hash);
      sets.push(`password_hash = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update." });
    sets.push(`updated_at = NOW()`);
    params.push(uid);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    // If password was changed, revoke every other refresh token so old devices
    // get logged out. The caller's current session survives because it uses an
    // access token, not the refresh table.
    if (newPassword) {
      try { await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [uid]); }
      catch { /* table may not exist on very old boots */ }
    }
    const { rows: [user] } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [uid]);
    return res.json(user);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Mobile number already in use." });
    console.error("PUT /auth/me error:", err.message);
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

module.exports = router;
module.exports.validatePassword = validatePassword;
module.exports.PASSWORD_MSG     = PASSWORD_MSG;
