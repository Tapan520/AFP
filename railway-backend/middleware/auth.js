// ?????????????????????????????????????????????????????????????????????????????
// middleware/auth.js  -  JWT authentication + role guard
// ?????????????????????????????????????????????????????????????????????????????
const jwt = require("jsonwebtoken");

const ROLE_RANK = {
  citizen:     0,
  ward_admin:  1,
  zone_admin:  2,
  nigam_admin: 3,
  city_admin:  4,
  super_admin: 5,
};

/**
 * authenticate  -  verify Bearer JWT and attach req.user
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, city_id, nigam_id, ward_id, ... }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

/**
 * requireRole(minRole)  -  reject if the caller's rank < minRole rank
 */
function requireRole(minRole) {
  return (req, res, next) => {
    const rank    = ROLE_RANK[req.user?.role] ?? -1;
    const minRank = ROLE_RANK[minRole]         ?? 99;
    if (rank < minRank) {
      return res.status(403).json({ error: "Insufficient permissions." });
    }
    next();
  };
}

/**
 * manageableRoles(role)  -  which roles a given role can manage
 */
function manageableRoles(role) {
  switch (role) {
    case "super_admin": return ["citizen","ward_admin","zone_admin","nigam_admin","city_admin","super_admin"];
    case "city_admin":  return ["citizen","ward_admin","zone_admin","nigam_admin"];
    case "nigam_admin": return ["citizen","ward_admin","zone_admin"];
    case "zone_admin":  return ["citizen","ward_admin"];
    case "ward_admin":  return ["citizen"];
    default:            return [];
  }
}

module.exports = { authenticate, requireRole, manageableRoles, ROLE_RANK };
