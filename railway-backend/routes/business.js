// ─────────────────────────────────────────────────────────────────────────────
// routes/business.js — Doctor / Shop directory application pipeline
//
// STATE MACHINE
//   draft         → row created by /apply, no docs yet
//   docs_uploaded → applicant uploaded verification cert
//   paid          → Razorpay registration fee captured (verified upstream)
//   approved      → super_admin verified docs + copied into doctors/shops
//                    (licence_expiry_date = NOW + 1 year)
//   rejected      → super_admin rejected; reason stored; refund_status flag
//                    tells the ops team whether to refund via Razorpay dashboard
//                    (the auto-refund API call is Phase 2b).
//
// A row is publishable only when status='approved'. The doctors/shops public
// GET routes also enforce `licence_expiry_date > NOW() - 30 days` so an
// expired listing disappears from citizen search without hard-deleting it.
//
// ROLES
//   Any authenticated user  → POST /apply, POST /:id/upload-doc, POST /:id/mark-paid,
//                              GET  /mine   (own applications only)
//   super_admin             → GET  /pending, PATCH /:id/approve, PATCH /:id/reject
//
// Endpoints:
//   POST  /api/business/apply
//   POST  /api/business/:id/upload-doc     (multipart: doc)
//   POST  /api/business/:id/mark-paid      ({ payment_id, order_id })
//   GET   /api/business/mine
//   GET   /api/business/pending            (super_admin)
//   PATCH /api/business/:id/approve        (super_admin) → creates doctors/shops row
//   PATCH /api/business/:id/reject         (super_admin, { reason })
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const multer  = require("multer");
const bcrypt  = require("bcryptjs");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { getStorage }    = require("../storage");
const { sendEmail }     = require("../utils/email");
const { refundPayment } = require("../utils/razorpay");
const { validatePassword, makeAccessToken, issueRefreshToken } = require("./auth");

const router  = express.Router();
const storage = getStorage();

// Docs may be a scan/photo of the qualification cert or GST/Udyam licence.
const DOC_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB — matches Cloudinary free-tier
const ALLOWED_DOC_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
]);
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: DOC_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_DOC_MIME.has(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP/PDF files are allowed."), ok);
  },
});

const VALID_TYPES    = new Set(["doctor", "shop"]);
const VALID_STATUSES = new Set(["draft", "docs_uploaded", "paid", "approved", "rejected", "expired"]);
const RENEWAL_YEARS  = 1;

// Slim projection joined with users so the admin queue shows contact info
// without an extra lookup. `docs_url` is filtered out for non-owner GETs by the
// route handler when we serialise.
const APP_SELECT = `
  SELECT
    ba.*,
    u.name  AS applicant_name,
    u.mobile AS applicant_mobile,
    u.email AS applicant_email,
    c.name  AS city_name,
    n.name  AS nigam_name,
    reviewer.name AS reviewed_by_name
  FROM business_applications ba
  LEFT JOIN users  u        ON u.id = ba.applicant_id
  LEFT JOIN users  reviewer ON reviewer.id = ba.reviewed_by
  LEFT JOIN cities c        ON c.id = ba.city_id
  LEFT JOIN nigams n        ON n.id = ba.nigam_id
`;

// ── POST /api/business/register  (PUBLIC — no auth) ─────────────────────────
// One-shot signup for a vet / shop applicant. Creates a citizen user account
// AND the draft business_applications row atomically, then returns a JWT so
// the applicant can immediately upload the doc + mark-paid without a second
// login. This mirrors the citizen POST /api/auth/register flow: a person who
// only wants to list a clinic or a shop should never need a pet-owner account
// created beforehand — the application form IS the signup.
//
// Body fields (superset of /apply + auth/register):
//   type, name, mobile, email, password,          ← required
//   qualification, specialization, clinicName,
//   ownerName, speciality, address, timings,
//   is24hr, licenceNo,
//   cityId, nigamId, zoneId, wardId               ← optional
//
// If the mobile is already registered → 409 with a hint to log in instead.
router.post("/register", async (req, res) => {
  const b = req.body || {};
  const type = String(b.type || "").toLowerCase();
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "type must be 'doctor' or 'shop'." });
  }
  const name     = String(b.name     || "").trim();
  const mobile   = String(b.mobile   || "").trim();
  const email    = b.email ? String(b.email).trim() : null;
  const password = String(b.password || "");
  if (!name || !mobile || !password) {
    return res.status(400).json({ error: "name, mobile and password are required." });
  }
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: "Invalid mobile number." });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  // Business-specific fields
  const qualification  = b.qualification  ? String(b.qualification).trim()  : null;
  const specialization = b.specialization ? String(b.specialization).trim() : null;
  const clinicName     = b.clinicName     ? String(b.clinicName).trim()     : null;
  const speciality     = b.speciality     ? String(b.speciality).trim()     : null;
  const ownerName      = b.ownerName      ? String(b.ownerName).trim()      : null;
  const address        = b.address        ? String(b.address).trim()        : null;
  const timings        = b.timings        ? String(b.timings).trim()        : null;
  const is24hr         = !!b.is24hr;
  const licenceNo      = b.licenceNo      ? String(b.licenceNo).trim()      : null;
  const cityId  = b.cityId  ? +b.cityId  : null;
  const nigamId = b.nigamId ? +b.nigamId : null;
  const zoneId  = b.zoneId  ? +b.zoneId  : null;
  const wardId  = b.wardId  ? +b.wardId  : null;

  try {
    // 1. Create the citizen account (role='citizen' — no elevated privileges).
    const hash = await bcrypt.hash(password, 10);
    let userId;
    try {
      const { rows: userRows } = await pool.query(
        `INSERT INTO users (name, mobile, email, password_hash, address, role,
                            city_id, nigam_id, zone_id, ward_id)
         VALUES ($1,$2,$3,$4,$5,'citizen',$6,$7,$8,$9)
         RETURNING id`,
        [name, mobile, email, hash, address, cityId, nigamId, zoneId, wardId]
      );
      userId = userRows[0].id;
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: "This mobile is already registered. Please log in and use the 'Register as Vet / Shop' link from the home screen instead.",
        });
      }
      throw err;
    }

    // 2. Create the draft business application, linked to the fresh user.
    const { rows: appRows } = await pool.query(
      `INSERT INTO business_applications
         (type, applicant_id, name, qualification, specialization, clinic_name,
          speciality, owner_name, address, mobile, timings, is_24hr, licence_no,
          city_id, nigam_id, zone_id, ward_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft')
       RETURNING id`,
      [type, userId, name, qualification, specialization, clinicName,
       speciality, ownerName, address, mobile, timings, is24hr, licenceNo,
       cityId, nigamId, zoneId, wardId]
    );
    const appId = appRows[0].id;

    // 3. Fetch the user row (with geo names) for the login response shape.
    const { rows: [user] } = await pool.query(
      `SELECT u.id, u.name, u.mobile, u.email, u.address, u.role,
              u.city_id, c.name AS city_name,
              u.nigam_id, n.name AS nigam_name,
              u.zone_id, z.name AS zone_name,
              u.ward_id, w.ward_number,
              u.is_active, u.created_at
         FROM users u
         LEFT JOIN cities c ON c.id = u.city_id
         LEFT JOIN nigams n ON n.id = u.nigam_id
         LEFT JOIN zones  z ON z.id = u.zone_id
         LEFT JOIN wards  w ON w.id = u.ward_id
        WHERE u.id = $1`,
      [userId]
    );

    // 4. Issue tokens so the applicant is logged in for the next steps
    //    (upload-doc + mark-paid) without a manual login.
    const token        = makeAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id, req, false);

    // 5. Fetch the enriched application row for the client.
    const { rows: [application] } = await pool.query(
      `${APP_SELECT} WHERE ba.id = $1`, [appId]
    );

    res.status(201).json({ application, user, token, refreshToken });
  } catch (err) {
    console.error("POST /api/business/register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/apply ─────────────────────────────────────────────────
// Creates the initial `draft` row. Fees paid + docs uploaded happen in later
// steps so a single failure never leaves the applicant in a broken state.
router.post("/apply", authenticate, async (req, res) => {
  const caller = req.user;
  const b = req.body || {};
  const type = String(b.type || "").toLowerCase();
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "type must be 'doctor' or 'shop'." });
  }
  const name    = String(b.name    || "").trim();
  const mobile  = String(b.mobile  || "").trim();
  const address = String(b.address || "").trim();
  if (!name || !mobile) {
    return res.status(400).json({ error: "name and mobile are required." });
  }

  // Type-specific required-ish fields (still soft so the applicant can amend
  // later, but we validate what we've got).
  const qualification  = b.qualification  ? String(b.qualification).trim()  : null;
  const specialization = b.specialization ? String(b.specialization).trim() : null;
  const clinicName     = b.clinicName     ? String(b.clinicName).trim()     : null;
  const speciality     = b.speciality     ? String(b.speciality).trim()     : null;
  const ownerName      = b.ownerName      ? String(b.ownerName).trim()      : null;
  const timings        = b.timings        ? String(b.timings).trim()        : null;
  const is24hr         = !!b.is24hr;
  const licenceNo      = b.licenceNo      ? String(b.licenceNo).trim()      : null;

  const cityId  = b.cityId  ? +b.cityId  : (caller.city_id  || null);
  const nigamId = b.nigamId ? +b.nigamId : null;
  const zoneId  = b.zoneId  ? +b.zoneId  : null;
  const wardId  = b.wardId  ? +b.wardId  : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO business_applications
         (type, applicant_id, name, qualification, specialization, clinic_name,
          speciality, owner_name, address, mobile, timings, is_24hr, licence_no,
          city_id, nigam_id, zone_id, ward_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft')
       RETURNING id`,
      [type, caller.id, name, qualification, specialization, clinicName,
       speciality, ownerName, address || null, mobile, timings, is24hr, licenceNo,
       cityId, nigamId, zoneId, wardId]
    );
    const { rows: [full] } = await pool.query(
      `${APP_SELECT} WHERE ba.id = $1`, [rows[0].id]
    );
    res.status(201).json(full);
  } catch (err) {
    console.error("POST /api/business/apply error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper: fetch application + enforce ownership OR super_admin.
async function _loadForCaller(appId, caller, { requireOwnerOrAdmin = true } = {}) {
  const { rows } = await pool.query(
    "SELECT * FROM business_applications WHERE id = $1", [appId]
  );
  if (!rows.length) return { error: 404, message: "Application not found." };
  const app = rows[0];
  if (!requireOwnerOrAdmin) return { app };
  if (caller.role === "super_admin")        return { app };
  if (app.applicant_id === caller.id)       return { app };
  return { error: 403, message: "Access denied." };
}

// ── POST /api/business/:id/upload-doc ────────────────────────────────────────
// Multipart form-data field name: `doc`. Uploads to Cloudinary (or whatever
// storage provider is configured) and stamps docs_url + moves status to
// docs_uploaded. Applicant can re-upload as many times as they like until
// they mark it paid; each upload overwrites the previous docs_url.
router.post("/:id/upload-doc", authenticate, docUpload.single("doc"), async (req, res) => {
  const appId = parseInt(req.params.id, 10);
  if (!Number.isInteger(appId)) return res.status(400).json({ error: "Invalid application id." });
  const guard = await _loadForCaller(appId, req.user);
  if (guard.error) return res.status(guard.error).json({ error: guard.message });
  if (!req.file)   return res.status(400).json({ error: "No doc file received." });

  // No further mutations after approve/reject
  if (["approved", "rejected"].includes(guard.app.status)) {
    return res.status(409).json({ error: `Cannot modify a ${guard.app.status} application.` });
  }

  try {
    const ext = req.file.mimetype === "application/pdf" ? ".pdf"
              : req.file.mimetype === "image/png"       ? ".png"
              : req.file.mimetype === "image/webp"      ? ".webp"
              :                                           ".jpg";
    const key = `business/${appId}-doc${ext}`;
    const { url } = await storage.put(key, req.file.buffer, req.file.mimetype);
    // Only bump status forward — never go backwards. If already `paid`, keep it.
    const nextStatus = guard.app.status === "draft" ? "docs_uploaded" : guard.app.status;
    await pool.query(
      `UPDATE business_applications
          SET docs_url   = $1,
              status     = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [url, nextStatus, appId]
    );
    res.json({ message: "Doc uploaded.", url, status: nextStatus });
  } catch (err) {
    console.error("upload-doc error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/business/:id/mark-paid ─────────────────────────────────────────
// Called after the client verifies the Razorpay payment via /api/payment?
// handler=Verify. We store the payment_id + order_id and bump status to
// `paid` so it appears in the super_admin approval queue.
router.post("/:id/mark-paid", authenticate, async (req, res) => {
  const appId = parseInt(req.params.id, 10);
  if (!Number.isInteger(appId)) return res.status(400).json({ error: "Invalid application id." });
  const guard = await _loadForCaller(appId, req.user);
  if (guard.error) return res.status(guard.error).json({ error: guard.message });
  if (["approved", "rejected"].includes(guard.app.status)) {
    return res.status(409).json({ error: `Cannot modify a ${guard.app.status} application.` });
  }

  const paymentId = String(req.body?.payment_id || "").trim();
  const orderId   = String(req.body?.order_id   || "").trim();
  if (!paymentId) return res.status(400).json({ error: "payment_id is required." });

  try {
    await pool.query(
      `UPDATE business_applications
          SET payment_id = $1,
              order_id   = $2,
              status     = 'paid',
              updated_at = NOW()
        WHERE id = $3`,
      [paymentId, orderId || null, appId]
    );
    res.json({ message: "Payment recorded.", status: "paid" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/my-listings ───────────────────────────────────────────
// Returns published doctor/shop rows owned by the caller (via applications
// they submitted), enriched with days-to-expiry so the citizen dashboard can
// show a renewal reminder banner at 30 / 7 / 0-day thresholds.
router.get("/my-listings", authenticate, async (req, res) => {
  try {
    const doctorsP = pool.query(
      `SELECT d.id, d.name, d.licence_expiry_date,
              'doctor' AS type,
              DATEDIFF(d.licence_expiry_date, CURDATE()) AS days_to_expiry
         FROM doctors d
         JOIN business_applications ba ON ba.id = d.source_application_id
        WHERE ba.applicant_id = $1
          AND d.licence_expiry_date IS NOT NULL`,
      [req.user.id]
    );
    const shopsP = pool.query(
      `SELECT s.id, s.name, s.licence_expiry_date,
              'shop' AS type,
              DATEDIFF(s.licence_expiry_date, CURDATE()) AS days_to_expiry
         FROM shops s
         JOIN business_applications ba ON ba.id = s.source_application_id
        WHERE ba.applicant_id = $1
          AND s.licence_expiry_date IS NOT NULL`,
      [req.user.id]
    );
    const [docs, shops] = await Promise.all([doctorsP, shopsP]);
    const all = [...docs.rows, ...shops.rows]
      .map(r => ({
        ...r,
        days_to_expiry: Number(r.days_to_expiry),
        needs_renewal:  Number(r.days_to_expiry) <= 30,
      }))
      .sort((a, b) => a.days_to_expiry - b.days_to_expiry);
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/mine ──────────────────────────────────────────────────
router.get("/mine", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${APP_SELECT} WHERE ba.applicant_id = $1 ORDER BY ba.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/business/pending ───────────────────────────────────────────────
// Super Admin queue. Optional ?type=doctor|shop and ?status=paid|docs_uploaded.
router.get("/pending", authenticate, requireRole("super_admin"), async (req, res) => {
  const where  = ["ba.status IN ('paid','docs_uploaded','draft')"];
  const params = [];
  if (VALID_TYPES.has(req.query.type)) {
    params.push(req.query.type);
    where.push(`ba.type = $${params.length}`);
  }
  if (VALID_STATUSES.has(req.query.status)) {
    // Override the default in-list filter with an exact match
    where[0] = `ba.status = $${params.length + 1}`;
    params.push(req.query.status);
  }
  try {
    const { rows } = await pool.query(
      `${APP_SELECT} WHERE ${where.join(" AND ")} ORDER BY ba.created_at ASC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/business/:id/approve ─────────────────────────────────────────
// Copies the row into `doctors` or `shops` (depending on type), sets the
// licence expiry to +1 year, and marks the application `approved`. The FK
// `published_ref_id` on the application points back to the new row so the
// UI can jump straight to it.
router.patch("/:id/approve", authenticate, requireRole("super_admin"), async (req, res) => {
  const appId = parseInt(req.params.id, 10);
  if (!Number.isInteger(appId)) return res.status(400).json({ error: "Invalid application id." });
  try {
    const { rows } = await pool.query(
      "SELECT * FROM business_applications WHERE id = $1", [appId]
    );
    if (!rows.length) return res.status(404).json({ error: "Application not found." });
    const app = rows[0];
    if (app.status !== "paid") {
      return res.status(409).json({
        error: `Application must be in 'paid' status to approve (current: '${app.status}').`,
      });
    }

    // Compute 1-year expiry (YYYY-MM-DD).
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + RENEWAL_YEARS);
    const expiryDate = expiry.toISOString().split("T")[0];

    let publishedId;
    if (app.type === "doctor") {
      const { rows: [d] } = await pool.query(
        `INSERT INTO doctors
           (name, qualification, specialization, clinic_name, address, mobile,
            timings, is_24hr, city_id, nigam_id, zone_id, ward_id,
            licence_no, licence_expiry_date, source_application_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [app.name, app.qualification, app.specialization, app.clinic_name,
         app.address, app.mobile, app.timings, !!app.is_24hr,
         app.city_id, app.nigam_id, app.zone_id, app.ward_id,
         app.licence_no, expiryDate, appId]
      );
      publishedId = d.id;
    } else {
      const { rows: [s] } = await pool.query(
        `INSERT INTO shops
           (name, owner_name, address, mobile, timings, speciality,
            city_id, nigam_id, zone_id, ward_id,
            licence_no, licence_expiry_date, source_application_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [app.name, app.owner_name, app.address, app.mobile, app.timings, app.speciality,
         app.city_id, app.nigam_id, app.zone_id, app.ward_id,
         app.licence_no, expiryDate, appId]
      );
      publishedId = s.id;
    }

    await pool.query(
      `UPDATE business_applications
          SET status              = 'approved',
              reviewed_by         = $1,
              reviewed_at         = NOW(),
              published_ref_id    = $2,
              licence_expiry_date = $3,
              admin_note          = COALESCE($4, admin_note),
              updated_at          = NOW()
        WHERE id = $5`,
      [req.user.id, publishedId, expiryDate, req.body?.note || null, appId]
    );

    // Fire-and-forget approval email (never blocks/breaks the response).
    _notifyApplicant(appId, "approved", {
      publishedId, expiryDate, type: app.type, name: app.name,
    }).catch(err => console.error("approve notify failed:", err.message));

    res.json({
      message:             "Approved and published.",
      id:                  appId,
      published_ref_id:    publishedId,
      licence_expiry_date: expiryDate,
    });
  } catch (err) {
    console.error("PATCH /api/business/approve error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/business/:id/reject ──────────────────────────────────────────
// Records the rejection reason. `refund_status` is set to 'pending' whenever
// the applicant had already paid — the ops team then processes the refund
// via Razorpay dashboard (auto-refund via API is Phase 2b). If the applicant
// never paid, `refund_status` stays NULL so the queue doesn't nag ops.
router.patch("/:id/reject", authenticate, requireRole("super_admin"), async (req, res) => {
  const appId  = parseInt(req.params.id, 10);
  const reason = String(req.body?.reason || "").trim();
  if (!Number.isInteger(appId)) return res.status(400).json({ error: "Invalid application id." });
  if (!reason) return res.status(400).json({ error: "reason is required for rejection." });
  try {
    const { rows } = await pool.query(
      "SELECT status, payment_id FROM business_applications WHERE id = $1", [appId]
    );
    if (!rows.length) return res.status(404).json({ error: "Application not found." });
    if (rows[0].status === "approved") {
      return res.status(409).json({ error: "Cannot reject an already-approved application." });
    }
    const paymentId    = rows[0].payment_id;
    const needsRefund  = !!paymentId;

    // Attempt auto-refund via Razorpay Refund API (Phase 2b). On any failure
    // we still mark the rejection as `pending` so ops can process manually.
    let refundStatus = null;
    let refundId     = null;
    let refundError  = null;
    if (needsRefund) {
      const r = await refundPayment(paymentId, {
        notes: { application_id: String(appId), reason: reason.slice(0, 250) },
      });
      if (r.ok) {
        refundStatus = "processed";
        refundId     = r.id || null;
      } else {
        refundStatus = "pending";
        refundError  = r.error;
        console.warn(`Refund failed for application ${appId}: ${r.error}`);
      }
    }

    await pool.query(
      `UPDATE business_applications
          SET status         = 'rejected',
              reject_reason  = $1,
              refund_status  = $2,
              reviewed_by    = $3,
              reviewed_at    = NOW(),
              updated_at     = NOW()
        WHERE id = $4`,
      [reason, refundStatus, req.user.id, appId]
    );

    _notifyApplicant(appId, "rejected", { reason, refundStatus, refundId })
      .catch(err => console.error("reject notify failed:", err.message));

    res.json({
      message:       "Rejected.",
      id:            appId,
      refund_status: refundStatus,
      refund_id:     refundId,
      refund_error:  refundError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Internal: send approve/reject notification email to the applicant ──────
// Best-effort — never throws. Uses utils/email which is a no-op when SMTP
// isn't configured.
async function _notifyApplicant(appId, kind, extras = {}) {
  const { rows } = await pool.query(
    `SELECT ba.type, ba.name, u.email, u.name AS applicant_name
       FROM business_applications ba
       LEFT JOIN users u ON u.id = ba.applicant_id
      WHERE ba.id = $1`,
    [appId]
  );
  if (!rows.length || !rows[0].email) return;
  const app     = rows[0];
  const kindTxt = app.type === "doctor" ? "veterinary listing" : "pet-shop listing";
  if (kind === "approved") {
    await sendEmail({
      to:      app.email,
      subject: `✅ Your ${kindTxt} "${app.name}" has been approved`,
      text:
`Hi ${app.applicant_name || "there"},

Good news — your ${kindTxt} "${app.name}" has been approved and is now live on the All For Pets directory.

Listing valid until: ${extras.expiryDate}
Renew any time from the /RegisterBusiness page.

— All For Pets`,
    });
  } else if (kind === "rejected") {
    const refundLine = extras.refundStatus === "processed"
      ? `Your registration fee has been auto-refunded via Razorpay (refund id: ${extras.refundId}). Please allow 5–7 working days for the amount to reflect.`
      : extras.refundStatus === "pending"
      ? "Your registration fee refund is pending — our team will process it manually within 5–7 working days."
      : "";
    await sendEmail({
      to:      app.email,
      subject: `❌ Update on your ${kindTxt} application`,
      text:
`Hi ${app.applicant_name || "there"},

Unfortunately your ${kindTxt} application ("${app.name}") could not be approved.

Reason from the reviewer:
  ${extras.reason}

${refundLine}

You can re-apply from /RegisterBusiness after addressing the issues above.

— All For Pets`,
    });
  }
}

module.exports = router;
module.exports.VALID_TYPES     = VALID_TYPES;
module.exports.VALID_STATUSES  = VALID_STATUSES;
module.exports.RENEWAL_YEARS   = RENEWAL_YEARS;
