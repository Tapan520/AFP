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

const router = express.Router();

// Disk storage — files saved to ./uploads/pets/ and served via express.static.
// Swap for cloud storage (S3, GCS, Cloudinary) when deploying to production.
const UPLOAD_DIR = path.join(__dirname, "../uploads/pets");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, _file, cb) => cb(null, `${req.params.id}-photo.jpg`),
  }),
  limits:     { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed for pet photos."), ok);
  },
});

const certUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
      const ext = file.mimetype === "application/pdf" ? ".pdf" : ".jpg";
      cb(null, `${req.params.id}-cert${ext}`);
    },
  }),
  limits:     { fileSize: 5 * 1024 * 1024 },
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
router.get("/stats", async (_req, res) => {
  try {
    const { rows: [totals] } = await pool.query(`
      SELECT
        COUNT(*)                                      AS "totalPets",
        COUNT(*) FILTER(WHERE registration_status='approved'
                          AND (licence_expiry_date IS NULL OR licence_expiry_date >= NOW())) AS "activeLicences",
        COUNT(*) FILTER(WHERE registration_status='pending')  AS "pendingCount"
      FROM pets
    `);
    const { rows: cities } = await pool.query(`
      SELECT
        c.name,
        COUNT(p.id)::int                                        AS total,
        COUNT(p.id) FILTER(WHERE p.species='dog')::int         AS dogs,
        COUNT(p.id) FILTER(WHERE p.species='cat')::int         AS cats,
        COUNT(p.id) FILTER(WHERE p.species NOT IN ('dog','cat'))::int AS others
      FROM cities c
      LEFT JOIN pets p ON p.city_id = c.id
      GROUP BY c.id
      ORDER BY total DESC
    `);
    res.json({ ...totals, cities });
  } catch (err) {
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
    const url = `/uploads/pets/${req.file.filename}`;
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
    const url = `/uploads/pets/${req.file.filename}`;
    await pool.query(
      "UPDATE pets SET certificate_url=$1, updated_at=NOW() WHERE id=$2",
      [url, req.params.id]
    );
    res.json({ message: "Certificate uploaded.", url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
