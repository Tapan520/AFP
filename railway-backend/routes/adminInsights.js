// ─────────────────────────────────────────────────────────────────────────────
// routes/adminInsights.js — Pet registration insights for admins
//
// GET /api/admin/insights
//   Returns geo-scoped breakdowns useful to Ward/Zone/Nigam/City/Super admins
//   to answer questions like "how many pets are registered in my ward?" and
//   "which breeds are most common?".
//
//   Response shape:
//     {
//       totals:         { total, approved, pending, rejected, active,
//                         expiring_30d, expired, breeding_opt_in },
//       bySpecies:      [{ species, count }],
//       byBreed:        [{ breed, species, count }],   // top 15
//       byGender:       [{ gender, count }],
//       byAgeGroup:     [{ bucket, count }],           // puppy/young/adult/senior/unknown
//       byLicenceStatus:[{ status, count }],           // active/expiring/expired/none
//     }
//
// Scoping: honours ward_admin / zone_admin / nigam_admin / city_admin /
// super_admin — same rules as /api/admin/stats.
//
// NOTE: db.js is a MySQL pool with a PostgreSQL-compat shim. Uses MySQL-native
// date functions (DATE_SUB, TIMESTAMPDIFF) and pg-style $N placeholders that
// the shim rewrites to `?`.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

function _scope(caller) {
  const where  = [];
  const params = [];
  if (caller.role === "ward_admin"  && caller.ward_id)       { params.push(caller.ward_id);  where.push(`p.ward_id  = $${params.length}`); }
  else if (caller.role === "zone_admin"  && caller.zone_id)  { params.push(caller.zone_id);  where.push(`p.ward_id IN (SELECT id FROM wards WHERE zone_id = $${params.length})`); }
  else if (caller.role === "nigam_admin" && caller.nigam_id) { params.push(caller.nigam_id); where.push(`p.nigam_id = $${params.length}`); }
  else if (caller.role === "city_admin"  && caller.city_id)  { params.push(caller.city_id);  where.push(`p.city_id  = $${params.length}`); }
  return { whereSQL: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

// Parse ?from=YYYY-MM-DD & ?to=YYYY-MM-DD query params into WHERE fragments
// against p.created_at. Silently ignores malformed values. Returns
// { clauses: string[], params: any[] } that callers merge into their own arrays.
const _ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function _dateRange(query, startIdx) {
  const clauses = [];
  const params  = [];
  let idx = startIdx;
  if (query && _ISO_DATE.test(query.from || "")) {
    params.push(query.from); idx++;
    clauses.push(`p.created_at >= $${idx}`);
  }
  if (query && _ISO_DATE.test(query.to || "")) {
    params.push(query.to);   idx++;
    // inclusive end-of-day: `to` + 1 day, strict less-than
    clauses.push(`p.created_at <  DATE_ADD($${idx}, INTERVAL 1 DAY)`);
  }
  return { clauses, params };
}

const toInt = (v) => (v == null ? 0 : parseInt(v, 10) || 0);

router.get("/", authenticate, requireRole("ward_admin"), async (req, res) => {
try {
  const scoped = _scope(req.user);
  const dr     = _dateRange(req.query, scoped.params.length);
  scoped.params.push(...dr.params);
  const allClauses = [];
  if (scoped.whereSQL) allClauses.push(scoped.whereSQL.replace(/^WHERE\s*/, ""));
  allClauses.push(...dr.clauses);
  const whereSQL = allClauses.length ? "WHERE " + allClauses.join(" AND ") : "";
  const andWhere = allClauses.length ? "AND "   + allClauses.join(" AND ") : "";
  const params   = scoped.params;

    // ── Totals ────────────────────────────────────────────────────────────
    const totalsRow = (await pool.query(
      `SELECT
         COUNT(*)                                                                              AS total,
         SUM(CASE WHEN p.registration_status = 'approved' THEN 1 ELSE 0 END)                   AS approved,
         SUM(CASE WHEN p.registration_status = 'pending'  THEN 1 ELSE 0 END)                   AS pending,
         SUM(CASE WHEN p.registration_status = 'rejected' THEN 1 ELSE 0 END)                   AS rejected,
         SUM(CASE WHEN p.registration_status = 'approved'
                   AND (p.licence_expiry_date IS NULL OR p.licence_expiry_date >= CURDATE())
                  THEN 1 ELSE 0 END)                                                           AS active,
         SUM(CASE WHEN p.registration_status = 'approved'
                   AND p.licence_expiry_date IS NOT NULL
                   AND p.licence_expiry_date >= CURDATE()
                   AND p.licence_expiry_date <  DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  THEN 1 ELSE 0 END)                                                           AS expiring_30d,
         SUM(CASE WHEN p.registration_status = 'approved'
                   AND p.licence_expiry_date IS NOT NULL
                   AND p.licence_expiry_date <  CURDATE()
                  THEN 1 ELSE 0 END)                                                           AS expired,
         SUM(CASE WHEN p.breeding_opt_in = TRUE THEN 1 ELSE 0 END)                             AS breeding_opt_in
       FROM pets p ${whereSQL}`,
      params
    )).rows[0] || {};

    const totals = {
      total:           toInt(totalsRow.total),
      approved:        toInt(totalsRow.approved),
      pending:         toInt(totalsRow.pending),
      rejected:        toInt(totalsRow.rejected),
      active:          toInt(totalsRow.active),
      expiring_30d:    toInt(totalsRow.expiring_30d),
      expired:         toInt(totalsRow.expired),
      breeding_opt_in: toInt(totalsRow.breeding_opt_in),
    };

    // ── By species (all statuses, so admins can see pending too) ──────────
    const bySpecies = (await pool.query(
      `SELECT COALESCE(p.species, 'unknown') AS species, COUNT(*) AS count
       FROM pets p ${whereSQL}
       GROUP BY p.species
       ORDER BY count DESC`,
      params
    )).rows.map(r => ({ species: r.species, count: toInt(r.count) }));

    // ── Top breeds (top 15, non-null) ─────────────────────────────────────
    const byBreed = (await pool.query(
      `SELECT p.breed AS breed, COALESCE(p.species, 'unknown') AS species, COUNT(*) AS count
       FROM pets p
       WHERE p.breed IS NOT NULL AND p.breed <> ''
         ${andWhere}
       GROUP BY p.breed, p.species
       ORDER BY count DESC
       LIMIT 15`,
      params
    )).rows.map(r => ({ breed: r.breed, species: r.species, count: toInt(r.count) }));

    // ── By gender ─────────────────────────────────────────────────────────
    const byGender = (await pool.query(
      `SELECT COALESCE(p.gender, 'unknown') AS gender, COUNT(*) AS count
       FROM pets p ${whereSQL}
       GROUP BY p.gender
       ORDER BY count DESC`,
      params
    )).rows.map(r => ({ gender: r.gender, count: toInt(r.count) }));

    // ── By age group (based on date_of_birth) ─────────────────────────────
    // puppy: <1yr · young: 1-3yr · adult: 3-8yr · senior: 8yr+ · unknown: no DOB
    const byAgeGroup = (await pool.query(
      `SELECT
         SUM(CASE WHEN p.date_of_birth IS NULL THEN 1 ELSE 0 END) AS unknown_c,
         SUM(CASE WHEN p.date_of_birth IS NOT NULL
                   AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) < 1
                  THEN 1 ELSE 0 END)                              AS puppy_c,
         SUM(CASE WHEN p.date_of_birth IS NOT NULL
                   AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) BETWEEN 1 AND 2
                  THEN 1 ELSE 0 END)                              AS young_c,
         SUM(CASE WHEN p.date_of_birth IS NOT NULL
                   AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) BETWEEN 3 AND 7
                  THEN 1 ELSE 0 END)                              AS adult_c,
         SUM(CASE WHEN p.date_of_birth IS NOT NULL
                   AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) >= 8
                  THEN 1 ELSE 0 END)                              AS senior_c
       FROM pets p ${whereSQL}`,
      params
    )).rows[0] || {};
    const byAgeGroupOut = [
      { bucket: "puppy (<1 yr)",     count: toInt(byAgeGroup.puppy_c) },
      { bucket: "young (1-2 yrs)",   count: toInt(byAgeGroup.young_c) },
      { bucket: "adult (3-7 yrs)",   count: toInt(byAgeGroup.adult_c) },
      { bucket: "senior (8+ yrs)",   count: toInt(byAgeGroup.senior_c) },
      { bucket: "unknown",           count: toInt(byAgeGroup.unknown_c) },
    ].filter(b => b.count > 0);

    // ── By licence status (approved pets only) ────────────────────────────
    const licenceRow = (await pool.query(
      `SELECT
         SUM(CASE WHEN p.licence_expiry_date IS NULL THEN 1 ELSE 0 END) AS none_c,
         SUM(CASE WHEN p.licence_expiry_date IS NOT NULL
                   AND p.licence_expiry_date >= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  THEN 1 ELSE 0 END)                                     AS active_c,
         SUM(CASE WHEN p.licence_expiry_date IS NOT NULL
                   AND p.licence_expiry_date >= CURDATE()
                   AND p.licence_expiry_date <  DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                  THEN 1 ELSE 0 END)                                     AS expiring_c,
         SUM(CASE WHEN p.licence_expiry_date IS NOT NULL
                   AND p.licence_expiry_date <  CURDATE()
                  THEN 1 ELSE 0 END)                                     AS expired_c
       FROM pets p
       WHERE p.registration_status = 'approved' ${andWhere}`,
      params
    )).rows[0] || {};
    const byLicenceStatus = [
      { status: "active",          count: toInt(licenceRow.active_c) },
      { status: "expiring in 30d", count: toInt(licenceRow.expiring_c) },
      { status: "expired",         count: toInt(licenceRow.expired_c) },
      { status: "no expiry set",   count: toInt(licenceRow.none_c) },
    ].filter(r => r.count > 0);

    res.json({ totals, bySpecies, byBreed, byGender, byAgeGroup: byAgeGroupOut, byLicenceStatus });
  } catch (err) {
    console.error("GET /admin/insights error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/insights/pets  — drill-down list
//
// Returns individual pets that match the given breakdown filter, so admins can
// go from "42 dogs · Labrador" straight to the actual owners + wards + vaccine
// status. Same geo-scoping rules as the summary endpoint above.
//
// Supported filters (any combination):
//   species        = dog | cat | other | <any string>
//   breed          = exact match (case-insensitive)
//   gender         = male | female | unknown
//   ageGroup       = puppy | young | adult | senior | unknown
//   licenceStatus  = active | expiring | expired | none
//   vaccinated     = yes | overdue | soon | none      (based on vaccine_next_due)
//   wardId         = int (narrows within caller scope)
//   zoneId         = int
//   status         = pending | approved | rejected   (registration_status)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/pets", authenticate, requireRole("ward_admin"), async (req, res) => {
try {
  const { whereSQL, params } = _scope(req.user);
  const where = whereSQL ? [whereSQL.replace(/^WHERE\s*/, "")] : [];
  const q = req.query || {};

  // Date range on registration timestamp
  const dr = _dateRange(q, params.length);
  params.push(...dr.params);
  where.push(...dr.clauses);

  const push = (cond, val) => { params.push(val); where.push(cond.replace("$$", `$${params.length}`)); };

    if (q.species)  push(`LOWER(p.species) = LOWER($$)`, q.species);
    if (q.breed)    push(`LOWER(p.breed)   = LOWER($$)`, q.breed);
    if (q.gender) {
      if (q.gender === "unknown") where.push(`(p.gender IS NULL OR p.gender = '')`);
      else                        push(`LOWER(p.gender) = LOWER($$)`, q.gender);
    }
    if (q.status)   push(`p.registration_status = $$`, q.status);
    if (q.wardId)   push(`p.ward_id  = $$`, parseInt(q.wardId, 10));

    switch (q.ageGroup) {
      case "puppy":   where.push(`p.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) < 1`); break;
      case "young":   where.push(`p.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) BETWEEN 1 AND 2`); break;
      case "adult":   where.push(`p.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) BETWEEN 3 AND 7`); break;
      case "senior":  where.push(`p.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) >= 8`); break;
      case "unknown": where.push(`p.date_of_birth IS NULL`); break;
    }

    switch (q.licenceStatus) {
      case "active":
        where.push(`p.registration_status = 'approved'
                    AND p.licence_expiry_date IS NOT NULL
                    AND p.licence_expiry_date >= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`);
        break;
      case "expiring":
        where.push(`p.registration_status = 'approved'
                    AND p.licence_expiry_date IS NOT NULL
                    AND p.licence_expiry_date >= CURDATE()
                    AND p.licence_expiry_date <  DATE_ADD(CURDATE(), INTERVAL 30 DAY)`);
        break;
      case "expired":
        where.push(`p.registration_status = 'approved'
                    AND p.licence_expiry_date IS NOT NULL
                    AND p.licence_expiry_date <  CURDATE()`);
        break;
      case "none":
        where.push(`p.registration_status = 'approved' AND p.licence_expiry_date IS NULL`);
        break;
    }

    switch (q.vaccinated) {
      case "yes":     where.push(`p.vaccine_next_due IS NOT NULL AND p.vaccine_next_due >= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`); break;
      case "soon":    where.push(`p.vaccine_next_due IS NOT NULL AND p.vaccine_next_due >= CURDATE() AND p.vaccine_next_due < DATE_ADD(CURDATE(), INTERVAL 30 DAY)`); break;
      case "overdue": where.push(`p.vaccine_next_due IS NOT NULL AND p.vaccine_next_due < CURDATE()`); break;
      case "none":    where.push(`p.vaccine_next_due IS NULL`); break;
    }

    if (q.breedingOptIn === "yes") where.push(`p.breeding_opt_in = TRUE`);

    const finalWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT
         p.id, p.pet_id, p.name, p.species, p.breed, p.colour, p.gender,
         p.date_of_birth, p.registration_status, p.licence_expiry_date,
         p.vaccine_next_due, p.breeding_opt_in, p.created_at,
         u.name  AS owner_name,
         u.mobile AS owner_mobile,
         c.name  AS city_name,
         n.name  AS nigam_name,
         w.ward_number,
         TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) AS age_years
       FROM pets p
       LEFT JOIN users  u ON u.id = p.owner_id
       LEFT JOIN cities c ON c.id = p.city_id
       LEFT JOIN nigams n ON n.id = p.nigam_id
       LEFT JOIN wards  w ON w.id = p.ward_id
       ${finalWhere}
       ORDER BY p.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/insights/pets error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
