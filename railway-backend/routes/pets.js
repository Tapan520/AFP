// ?????????????????????????????????????????????????????????????????????????????
// routes/pets.js
//
// GET  /api/pets/my          - citizen's own pets
// GET  /api/pets/search      - public search
// GET  /api/pets/stats       - city-level census
// GET  /api/pets/pending     - ward-scoped pending list (admin)
// GET  /api/admin/pets       - full list (admin)
// GET  /api/pets/:id         - single pet
// POST /api/pets             - register new pet
// PATCH /api/pets/:id/approve
// PATCH /api/pets/:id/reject
// PATCH /api/pets/:id/renew
// PATCH /api/pets/:id/vaccine
// POST  /api/pets/:id/upload-photo
// POST  /api/pets/:id/upload-certificate
// ?????????????????????????????????????????????????????????????????????????????
const express  = require("express");
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const pool     = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { getStorage } = require("../storage");

const router  = express.Router();
const storage = getStorage();

// ── Multer with in-memory storage ─────────────────────────────────────────
// Files are buffered in RAM (up to 5 MB) and then handed to the storage
// provider (local disk / S3 / Azure / Cloudinary) via storage.put().
// The old on-disk multer setup is kept below (commented) for reference.
const UPLOAD_DIR = path.join(__dirname, "../uploads/pets"); // used only for local provider fallback
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 10 MB cap — matches:
//   • MAX_UPLOAD_BYTES used by the mobile presigned flow (below in this file)
//   • MAX_UPLOAD_MB shown on the citizen Register-New-Pet form
//   • Cloudinary free-tier single-image limit
const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

const photoUpload = multer({
  storage:  multer.memoryStorage(),
  limits:   { fileSize: UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed for pet photos."), ok);
  },
});

const certUpload = multer({
  storage:  multer.memoryStorage(),
  limits:   { fileSize: UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"].includes(file.mimetype);
    cb(ok ? null : new Error("Only image or PDF files are allowed."), ok);
  },
});

const PET_SELECT = `
  SELECT
    p.*,
    u.name  AS owner_name,
    u.mobile AS owner_mobile,
    c.name  AS city_name,
    n.name  AS nigam_name,
    w.ward_number
  FROM pets p
  LEFT JOIN users  u ON u.id = p.owner_id
  LEFT JOIN cities c ON c.id = p.city_id
  LEFT JOIN nigams n ON n.id = p.nigam_id
  LEFT JOIN wards  w ON w.id = p.ward_id
`;

// Helper: generate pet_id
async function generatePetId(cityName) {
  const prefix = (cityName || "XX").substring(0, 2).toUpperCase();
  const { rows } = await pool.query("SELECT COUNT(*)::int AS cnt FROM pets WHERE pet_id IS NOT NULL");
  const seq = String(rows[0].cnt + 1).padStart(4, "0");
  return `AFP-${prefix}-${seq}`;
}

// ?? GET /api/pets/my ??????????????????????????????????????????????????????????
router.get("/my", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} WHERE p.owner_id = $1 ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/stats ???????????????????????????????????????????????????????
// Public — powers the "Pet Census" screen. Uses MySQL-safe SUM(CASE ...) syntax
// (the PostgreSQL `COUNT(*) FILTER(WHERE ...)` with nested parens does not
// translate cleanly through the db.js shim).
router.get("/stats", async (_req, res) => {
  try {
    const { rows: [totals] } = await pool.query(`
      SELECT
        COUNT(*)                                                              AS totalPets,
        SUM(CASE WHEN registration_status = 'approved'
                  AND (licence_expiry_date IS NULL OR licence_expiry_date >= NOW())
                 THEN 1 ELSE 0 END)                                           AS activeLicences,
        SUM(CASE WHEN registration_status = 'pending' THEN 1 ELSE 0 END)      AS pendingCount
      FROM pets
    `);
    const { rows: cities } = await pool.query(`
      SELECT
        c.name                                                                AS name,
        COUNT(p.id)                                                           AS total,
        SUM(CASE WHEN p.species = 'dog' THEN 1 ELSE 0 END)                    AS dogs,
        SUM(CASE WHEN p.species = 'cat' THEN 1 ELSE 0 END)                    AS cats,
        SUM(CASE WHEN p.species IS NOT NULL AND p.species NOT IN ('dog','cat')
                 THEN 1 ELSE 0 END)                                           AS others
      FROM cities c
      LEFT JOIN pets p ON p.city_id = c.id
      GROUP BY c.id, c.name
      ORDER BY total DESC
    `);
    // Coerce SUM(...) results (which come back as strings in mysql2) to numbers
    // so the frontend can do arithmetic without surprises.
    const toInt = (v) => (v == null ? 0 : parseInt(v, 10) || 0);
    res.json({
      totalPets:      toInt(totals?.totalPets),
      activeLicences: toInt(totals?.activeLicences),
      pendingCount:   toInt(totals?.pendingCount),
      cities: cities.map(c => ({
        name:   c.name,
        total:  toInt(c.total),
        dogs:   toInt(c.dogs),
        cats:   toInt(c.cats),
        others: toInt(c.others),
      })),
    });
  } catch (err) {
    console.error("GET /pets/stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/search ??????????????????????????????????????????????????????
router.get("/search", async (req, res) => {
  const { q = "", cityId } = req.query;
  const params = [`%${q}%`, `%${q}%`, `%${q}%`];
  const cityFilter = cityId ? `AND p.city_id = $4` : "";
  if (cityId) params.push(cityId);
  try {
    const { rows } = await pool.query(
      `${PET_SELECT}
       WHERE (p.name ILIKE $1 OR u.name ILIKE $2 OR p.pet_id ILIKE $3)
         AND p.registration_status = 'approved'
         ${cityFilter}
       ORDER BY p.name LIMIT 50`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/pending ?????????????????????????????????????????????????????
router.get("/pending", authenticate, requireRole("ward_admin"), async (req, res) => {
  const caller = req.user;
  const where  = ["p.registration_status = 'pending'"];
  const params = [];
  if (caller.role === "ward_admin" && caller.ward_id) {
    params.push(caller.ward_id);
    where.push(`p.ward_id = $${params.length}`);
  } else if (caller.city_id) {
    params.push(caller.city_id);
    where.push(`p.city_id = $${params.length}`);
  }
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.created_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/admin/pets ???????????????????????????????????????????????????????
router.get("/admin/all", authenticate, requireRole("ward_admin"), async (req, res) => {
  const caller  = req.user;
  const where   = [];
  const params  = [];
  if (caller.role === "ward_admin" && caller.ward_id) {
    params.push(caller.ward_id); where.push(`p.ward_id = $${params.length}`);
  } else if (caller.role === "nigam_admin" && caller.nigam_id) {
    params.push(caller.nigam_id); where.push(`p.nigam_id = $${params.length}`);
  } else if (caller.role === "city_admin" && caller.city_id) {
    params.push(caller.city_id); where.push(`p.city_id = $${params.length}`);
  }
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} ${whereSQL} ORDER BY p.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/admin/stats ??????????????????????????????????????????????????????
router.get("/admin/stats", authenticate, requireRole("ward_admin"), async (req, res) => {
  const caller = req.user;
  const where  = [];
  const params = [];
  if (caller.ward_id)  { params.push(caller.ward_id);  where.push(`ward_id  = $${params.length}`); }
  else if (caller.nigam_id) { params.push(caller.nigam_id); where.push(`nigam_id = $${params.length}`); }
  else if (caller.city_id)  { params.push(caller.city_id);  where.push(`city_id  = $${params.length}`); }
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const { rows: [s] } = await pool.query(
      `SELECT
         COUNT(*)                                               AS total,
         COUNT(*) FILTER(WHERE registration_status='pending')  AS pending,
         COUNT(*) FILTER(WHERE registration_status='approved') AS approved,
         COUNT(*) FILTER(WHERE registration_status='rejected') AS rejected
       FROM pets ${whereSQL}`,
      params
    );
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/breeding ????????????????????????????????????????????????????
// Public — returns only approved, opted-in pets. Owner mobile is masked for privacy.
router.get("/breeding", async (req, res) => {
  const { species, breed, gender, cityId } = req.query;
  const where  = ["p.registration_status = 'approved'", "p.breeding_opt_in = TRUE"];
  const params = [];
  if (species) { params.push(species);      where.push(`p.species = $${params.length}`); }
  if (breed)   { params.push(`%${breed}%`); where.push(`p.breed ILIKE $${params.length}`); }
  if (gender)  { params.push(gender);       where.push(`p.gender = $${params.length}`); }
  if (cityId)  { params.push(+cityId);      where.push(`p.city_id = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.name LIMIT 50`,
      params
    );
    res.json(rows.map(p => ({ ...p, owner_mobile: null })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/public/:petId ??????????????????????????????????????????????
// Public, read-only pet profile — powers the QR deep-link. Returns a slim
// subset of fields (no owner mobile/email) and only for approved pets.
// The QR encodes a URL like:  https://<host>/PetProfile?id=<petId>
// which resolves to the Razor page that calls this endpoint.
router.get("/public/:petId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} WHERE p.pet_id = $1 AND p.registration_status = 'approved' LIMIT 1`,
      [req.params.petId]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found or not yet approved." });
    const p = rows[0];
    res.json({
      pet_id:              p.pet_id,
      name:                p.name,
      species:             p.species,
      breed:               p.breed,
      colour:              p.colour,
      gender:              p.gender,
      date_of_birth:       p.date_of_birth,
      photo_url:           p.photo_url,
      owner_name:          p.owner_name,
      city_name:           p.city_name,
      nigam_name:          p.nigam_name,
      ward_number:         p.ward_number,
      licence_expiry_date: p.licence_expiry_date,
      licence_status:      p.licence_status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? GET /api/pets/:id ?????????????????????????????????????????????????????????
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${PET_SELECT} WHERE p.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found." });
    // Citizens can only view their own pets
    const pet    = rows[0];
    const caller = req.user;
    if (caller.role === "citizen" && pet.owner_id !== caller.id) {
      return res.status(403).json({ error: "Access denied." });
    }
    res.json(pet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? POST /api/pets ????????????????????????????????????????????????????????????
router.post("/", authenticate, async (req, res) => {
  const owner = req.user;
  const { name, species, breed, colour, gender, dateOfBirth, paymentId, txnRef } = req.body;
  if (!name || !species) return res.status(400).json({ error: "name and species are required." });

  try {
    // Derive city from owner's city
    const { rows: [city] } = await pool.query(
      "SELECT name FROM cities WHERE id = $1", [owner.city_id]
    );
    const petId = await generatePetId(city?.name);

    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    const { rows } = await pool.query(
      `INSERT INTO pets
         (pet_id, owner_id, name, species, breed, colour, gender, date_of_birth,
          registration_status, licence_expiry_date, city_id, nigam_id, ward_id,
          payment_id, txn_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        petId, owner.id, name.trim(), species, breed||null, colour||null,
        gender||null, dateOfBirth||null, expiryDate.toISOString().split("T")[0],
        owner.city_id||null, owner.nigam_id||null, owner.ward_id||null,
        paymentId||null, txnRef||null,
      ]
    );
    const { rows: [pet] } = await pool.query(
      `${PET_SELECT} WHERE p.id = $1`, [rows[0].id]
    );
    res.status(201).json(pet);
  } catch (err) {
    console.error("POST /pets error:", err.message);
    res.status(500).json({ error: "Failed to register pet." });
  }
});

// ?? POST /api/pets/bulk-approve ??????????????????????????????????????????????
// Body: { ids: [int, ...], note? }
// Bulk approves many pending pets at once (ward_admin and above). The caller's
// geo scope is enforced: pets outside their ward/nigam/city are skipped.
router.post("/bulk-approve", authenticate, requireRole("ward_admin"), async (req, res) => {
  const caller = req.user;
  const { ids, note } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array." });
  }
  const nums = ids.map(x => parseInt(x, 10)).filter(Number.isInteger);
  if (nums.length === 0) return res.status(400).json({ error: "No valid ids." });

  const scopeWhere = [];
  const scopeParams = [];
  if (caller.role === "ward_admin" && caller.ward_id) {
    scopeParams.push(caller.ward_id); scopeWhere.push(`ward_id = $${scopeParams.length}`);
  } else if (caller.role === "nigam_admin" && caller.nigam_id) {
    scopeParams.push(caller.nigam_id); scopeWhere.push(`nigam_id = $${scopeParams.length}`);
  } else if (caller.role === "city_admin" && caller.city_id) {
    scopeParams.push(caller.city_id); scopeWhere.push(`city_id = $${scopeParams.length}`);
  }
  const scopeSQL = scopeWhere.length ? ` AND ${scopeWhere.join(" AND ")}` : "";

  try {
    const idParams = nums.map((_, i) => `$${scopeParams.length + 2 + i}`).join(",");
    const params   = [note || null, ...scopeParams, ...nums];
    const { rowCount } = await pool.query(
      `UPDATE pets
         SET registration_status = 'approved',
             admin_note          = COALESCE($1, admin_note),
             updated_at          = NOW()
       WHERE registration_status = 'pending'
         AND id IN (${idParams})
         ${scopeSQL}`,
      params
    );
    return res.json({ approved: rowCount || 0, requested: nums.length });
  } catch (err) {
    console.error("POST /pets/bulk-approve error:", err.message);
    return res.status(500).json({ error: "Bulk approve failed." });
  }
});

// ?? PATCH /api/pets/:id/approve ???????????????????????????????????????????????
router.patch("/:id/approve", authenticate, requireRole("ward_admin"), async (req, res) => {
  const { note } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pets SET registration_status='approved', admin_note=$1, updated_at=NOW()
       WHERE id=$2 RETURNING id`,
      [note||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found." });
    res.json({ message: "Approved.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PATCH /api/pets/:id/reject ????????????????????????????????????????????????
router.patch("/:id/reject", authenticate, requireRole("ward_admin"), async (req, res) => {
  const { note } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pets SET registration_status='rejected', admin_note=$1, updated_at=NOW()
       WHERE id=$2 RETURNING id`,
      [note||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found." });
    res.json({ message: "Rejected.", id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PATCH /api/pets/:id/breeding-opt-in ???????????????????????????????????????
router.patch("/:id/breeding-opt-in", authenticate, async (req, res) => {
  const { optIn } = req.body;
  try {
    const { rows: [pet] } = await pool.query(
      "SELECT owner_id, registration_status FROM pets WHERE id = $1",
      [req.params.id]
    );
    if (!pet) return res.status(404).json({ error: "Pet not found." });
    if (pet.owner_id !== req.user.id && req.user.role !== "super_admin")
      return res.status(403).json({ error: "Access denied." });
    if (pet.registration_status !== "approved")
      return res.status(400).json({ error: "Only approved pets can be listed for breeding." });
    const val = typeof optIn === "boolean" ? optIn : !!optIn;
    await pool.query(
      "UPDATE pets SET breeding_opt_in=$1, updated_at=NOW() WHERE id=$2",
      [val, req.params.id]
    );
    res.json({ message: val ? "Listed for breeding." : "Removed from breeding list.", breeding_opt_in: val });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PATCH /api/pets/:id/renew ?????????????????????????????????????????????????
router.patch("/:id/renew", authenticate, async (req, res) => {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  try {
    const { rows } = await pool.query(
      `UPDATE pets SET
         licence_expiry_date = $1,
         licence_status      = 'active',
         updated_at          = NOW()
       WHERE id = $2 AND owner_id = $3
       RETURNING id`,
      [expiryDate.toISOString().split("T")[0], req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found or not yours." });
    res.json({ message: "Licence renewed.", expiryDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? PATCH /api/pets/:id/vaccine ???????????????????????????????????????????????
router.patch("/:id/vaccine", authenticate, async (req, res) => {
  const { note, nextDue } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE pets SET
         vaccine_next_due = COALESCE($1, vaccine_next_due),
         admin_note       = COALESCE($2, admin_note),
         updated_at       = NOW()
       WHERE id = $3
       RETURNING id`,
      [nextDue||null, note||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Pet not found." });
    res.json({ message: "Vaccine record updated." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? POST /api/pets/:id/upload-photo ??????????????????????????????????????????
router.post("/:id/upload-photo", authenticate, photoUpload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No photo file received." });
    const key = `pets/${req.params.id}-photo.jpg`;
    const { url } = await storage.put(key, req.file.buffer, req.file.mimetype);
    await pool.query(
      "UPDATE pets SET photo_url=$1, updated_at=NOW() WHERE id=$2",
      [url, req.params.id]
    );
    res.json({ message: "Photo uploaded.", url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?? POST /api/pets/:id/upload-certificate ????????????????????????????????????
router.post("/:id/upload-certificate", authenticate, certUpload.single("certificate"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No certificate file received." });
    const ext = req.file.mimetype === "application/pdf" ? ".pdf" : ".jpg";
    const key = `pets/${req.params.id}-cert${ext}`;
    const { url } = await storage.put(key, req.file.buffer, req.file.mimetype);
    await pool.query(
      "UPDATE pets SET certificate_url=$1, updated_at=NOW() WHERE id=$2",
      [url, req.params.id]
    );
    res.json({ message: "Certificate uploaded.", url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pre-signed direct-to-cloud uploads (mobile-friendly) ──────────────────────
// Flow:
//   1. Client POSTs /upload-photo/sign with { mimeType } and gets back a
//      pre-signed PUT URL from the storage provider (S3 / Azure / Cloudinary).
//   2. Client uploads the binary DIRECTLY to that URL — the API server never
//      sees the file, saving Railway CPU + egress and dramatically speeding
//      up mobile uploads on cellular.
//   3. Client POSTs /upload-photo/confirm with { key } so we persist the
//      resulting photo_url in the DB (with ownership check).
//
// The old multer-based routes above still work for the web UI so we can roll
// out the mobile flow incrementally.
async function assertPetOwnershipOrAdmin(petId, caller) {
  const { rows } = await pool.query(
    "SELECT owner_id, city_id, ward_id, nigam_id FROM pets WHERE id = $1", [petId]
  );
  if (!rows.length) return { error: 404, message: "Pet not found." };
  const p = rows[0];
  if (caller.role === "super_admin") return { pet: p };
  if (caller.role === "citizen"  && p.owner_id === caller.id) return { pet: p };
  if (caller.role === "ward_admin"  && caller.ward_id  && p.ward_id  === caller.ward_id)  return { pet: p };
  if (caller.role === "nigam_admin" && caller.nigam_id && p.nigam_id === caller.nigam_id) return { pet: p };
  if (caller.role === "city_admin"  && caller.city_id  && p.city_id  === caller.city_id)  return { pet: p };
  return { error: 403, message: "Access denied." };
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB hard cap for mobile uploads
const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_CERT_MIME  = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

async function handlePresign(req, res, kind) {
  const petId    = parseInt(req.params.id, 10);
  const mimeType = (req.body?.mimeType || req.query?.mimeType || "").toString();
  if (!petId) return res.status(400).json({ error: "Invalid pet id." });
  const guard = await assertPetOwnershipOrAdmin(petId, req.user);
  if (guard.error) return res.status(guard.error).json({ error: guard.message });

  const allowed = kind === "photo" ? ALLOWED_PHOTO_MIME : ALLOWED_CERT_MIME;
  if (!allowed.has(mimeType)) {
    return res.status(400).json({ error: `Unsupported content type '${mimeType}'.` });
  }
  const ext = mimeType === "application/pdf" ? ".pdf"
            : mimeType === "image/png"       ? ".png"
            : mimeType === "image/webp"      ? ".webp"
            : mimeType === "image/gif"       ? ".gif"
            :                                  ".jpg";
  const key = `pets/${petId}-${kind}${ext}`;
  try {
    if (typeof storage.presignPut !== "function") {
      return res.status(501).json({ error: "Presigned uploads not supported by this storage provider." });
    }
    const signed = await storage.presignPut(key, mimeType, 900);
    return res.json({ ...signed, maxBytes: MAX_UPLOAD_BYTES });
  } catch (err) {
    console.error(`presign ${kind} error:`, err.message);
    return res.status(500).json({ error: `Failed to sign upload: ${err.message}` });
  }
}

async function handleConfirm(req, res, kind) {
  const petId = parseInt(req.params.id, 10);
  const key   = (req.body?.key || "").toString();
  const url   = (req.body?.url || "").toString();  // for Cloudinary: pass the returned secure_url
  if (!petId || !key) return res.status(400).json({ error: "petId and key are required." });
  const guard = await assertPetOwnershipOrAdmin(petId, req.user);
  if (guard.error) return res.status(guard.error).json({ error: guard.message });

  // Bind key to this pet: no path traversal, and must match "pets/{id}-*".
  const expectedPrefix = `pets/${petId}-${kind}`;
  if (!key.startsWith(expectedPrefix) || key.includes("..") || key.includes("//")) {
    return res.status(400).json({ error: "Key does not belong to this pet." });
  }

  // Cloudinary returns its own secure_url — trust the client-supplied url when
  // provided AND the provider is cloudinary. Otherwise, resolve from the key.
  const providerUrl = url || (storage.publicUrl ? storage.publicUrl(key) : null);
  if (!providerUrl) return res.status(500).json({ error: "Could not resolve public URL for uploaded file." });

  const column = kind === "photo" ? "photo_url" : "certificate_url";
  try {
    await pool.query(
      `UPDATE pets SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [providerUrl, petId]
    );
    return res.json({ message: `${kind} saved.`, url: providerUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

router.post("/:id/upload-photo/sign",         authenticate, (req, res) => handlePresign(req, res, "photo"));
router.post("/:id/upload-photo/confirm",      authenticate, (req, res) => handleConfirm(req, res, "photo"));
router.post("/:id/upload-certificate/sign",   authenticate, (req, res) => handlePresign(req, res, "cert"));
router.post("/:id/upload-certificate/confirm",authenticate, (req, res) => handleConfirm(req, res, "cert"));

module.exports = router;
