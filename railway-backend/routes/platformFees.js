// ─────────────────────────────────────────────────────────────────────────────
// routes/platformFees.js — Portal-level fees for doctor / shop listings
//
// These fees flow to the AFP platform operator (NOT the Municipal Corporation).
// A single row per `fee_type` — no per-city variation, keeping the pricing
// simple and consistent across the entire portal. Super Admin owns the values;
// City / Nigam admins don't see them (revenue isn't theirs).
//
// Endpoints:
//   GET  /api/platform-fees                  → all fees (any signed-in user)
//   GET  /api/platform-fees/resolve?feeType= → single fee (any signed-in user)
//   PUT  /api/platform-fees                  → replace/update fees (super_admin)
//   GET  /api/platform-fees/history          → audit log      (super_admin)
//
// Fee types (mirrored in .NET PaymentModel):
//   doctor_registration    default 500
//   doctor_renewal         default 300
//   shop_registration      default 300
//   shop_renewal           default 200
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const pool    = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// Canonical list — the four platform-fee slots we support today. Any other
// fee_type on PUT/GET is rejected so bad clients can't create arbitrary rows.
const FEE_TYPES = Object.freeze([
  "doctor_registration",
  "doctor_renewal",
  "shop_registration",
  "shop_renewal",
]);

// Fallback amounts when the DB row is missing (fresh boot, before any admin
// has ever edited the fees). Keep in sync with PaymentModel constants.
const DEFAULTS = Object.freeze({
  doctor_registration: 500,
  doctor_renewal:      300,
  shop_registration:   300,
  shop_renewal:        200,
});

const FEE_MIN = 0;
const FEE_MAX = 10_000;

function _validateFee(label, raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
  if (n < FEE_MIN || n > FEE_MAX) {
    return { ok: false, error: `${label} must be between \u20B9${FEE_MIN} and \u20B9${FEE_MAX}.` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

// ── GET /api/platform-fees ───────────────────────────────────────────────────
// Returns the full matrix padded with defaults so the client can render a
// complete editor / preview without an extra round-trip.
router.get("/", authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT fee_type, amount, updated_at FROM platform_fees"
    );
    const byType = new Map(rows.map(r => [r.fee_type, r]));
    const out    = FEE_TYPES.map(t => {
      const existing = byType.get(t);
      return {
        fee_type:   t,
        amount:     existing ? Number(existing.amount) : DEFAULTS[t],
        updated_at: existing ? existing.updated_at    : null,
        is_default: !existing,
      };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform-fees/resolve?feeType=doctor_registration ──────────────
// Small helper used by both the .NET payment proxy and the citizen UI so they
// can look up a single fee without unpacking the full array.
router.get("/resolve", authenticate, async (req, res) => {
  const t = String(req.query.feeType || "").toLowerCase();
  if (!FEE_TYPES.includes(t)) {
    return res.status(400).json({ error: `Unknown feeType '${t}'.` });
  }
  try {
    const { rows } = await pool.query(
      "SELECT amount FROM platform_fees WHERE fee_type = $1", [t]
    );
    if (rows.length && rows[0].amount != null) {
      return res.json({
        feeType:      t,
        amount:       Number(rows[0].amount),
        resolvedFrom: "platform",
      });
    }
    res.json({ feeType: t, amount: DEFAULTS[t], resolvedFrom: "default" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/platform-fees ─────────────────────────────────────────────────
// Body: { fees: [{ fee_type, amount }, ...] }
// Only known fee_types are accepted. Every real change writes a history row.
router.put("/", authenticate, requireRole("super_admin"), async (req, res) => {
  const { fees } = req.body || {};
  if (!Array.isArray(fees)) {
    return res.status(400).json({ error: "fees must be an array." });
  }

  const caller = req.user;
  const changes = [];   // for the audit trail

  // Validate first — fail fast, don't half-apply.
  const normalised = [];
  for (const f of fees) {
    const t = String(f.fee_type || "").toLowerCase();
    if (!FEE_TYPES.includes(t)) {
      return res.status(400).json({ error: `Unknown feeType '${t}'.` });
    }
    const v = _validateFee(t, f.amount);
    if (!v.ok) return res.status(400).json({ error: v.error });
    if (v.value == null) continue;   // client sent blank → skip
    normalised.push({ fee_type: t, amount: v.value });
  }

  try {
    // Fetch current values so we can detect true changes.
    const { rows: cur } = await pool.query(
      "SELECT fee_type, amount FROM platform_fees"
    );
    const byType = new Map(cur.map(r => [r.fee_type, Number(r.amount)]));

    for (const n of normalised) {
      const before = byType.has(n.fee_type) ? byType.get(n.fee_type) : null;
      if (before != null && Number(before) === Number(n.amount)) continue;

      // Upsert: UPDATE first, INSERT if missing (shim-safe).
      const { rowCount } = await pool.query(
        `UPDATE platform_fees
            SET amount     = $1,
                updated_at = NOW(),
                updated_by = $2
          WHERE fee_type = $3`,
        [n.amount, caller.id, n.fee_type]
      );
      if (!rowCount) {
        await pool.query(
          `INSERT INTO platform_fees (fee_type, amount, updated_by)
           VALUES ($1, $2, $3)`,
          [n.fee_type, n.amount, caller.id]
        );
      }
      changes.push({ fee_type: n.fee_type, old: before, new: n.amount });
    }

    // Append audit rows (best-effort; primary write must not fail).
    for (const c of changes) {
      try {
        await pool.query(
          `INSERT INTO platform_fee_history (fee_type, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4)`,
          [c.fee_type, c.old, c.new, caller.id]
        );
      } catch (err) {
        console.error("platform_fee_history insert failed:", err.message);
      }
    }

    res.json({ updated: changes.length, changes });
  } catch (err) {
    console.error("PUT /api/platform-fees error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform-fees/history — last 200 changes ───────────────────────
router.get("/history", authenticate, requireRole("super_admin"), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.fee_type, h.old_value, h.new_value, h.changed_at,
              h.changed_by, u.name AS changed_by_name
         FROM platform_fee_history h
         LEFT JOIN users u ON u.id = h.changed_by
         ORDER BY h.changed_at DESC
         LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.FEE_TYPES = FEE_TYPES;
module.exports.DEFAULTS  = DEFAULTS;
