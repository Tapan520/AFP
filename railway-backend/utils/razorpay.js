// ─────────────────────────────────────────────────────────────────────────────
// utils/razorpay.js — Server-side Razorpay REST helpers.
//
// We do NOT depend on the razorpay npm package. All calls go through the
// public REST API using Basic auth, which keeps deps light and matches how the
// .NET Payment page (Pages/Payment.cshtml.cs) talks to Razorpay.
//
// Credentials are read from env: RAZORPAY_PLATFORM_KEY_ID + KEY_SECRET, with a
// fallback to RAZORPAY_KEY_ID + KEY_SECRET for backwards compat with existing
// single-account deployments.
// ─────────────────────────────────────────────────────────────────────────────

function _platformCreds() {
  const keyId  = process.env.RAZORPAY_PLATFORM_KEY_ID  || process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_PLATFORM_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

/**
 * Issue a refund against a captured payment.
 * Docs: https://razorpay.com/docs/api/payments/refunds/
 *
 * @param {string} paymentId  Razorpay payment id (pay_XXXXXXX)
 * @param {object} [opts]     { amountPaise?, notes? } — omit amount for full refund
 * @returns {{ ok:boolean, id?:string, status?:string, error?:string }}
 */
async function refundPayment(paymentId, opts = {}) {
  if (!paymentId) return { ok: false, error: "paymentId is required" };
  const creds = _platformCreds();
  if (!creds) {
    return { ok: false, error: "Razorpay platform credentials not configured (RAZORPAY_PLATFORM_KEY_ID/SECRET)" };
  }
  try {
    const body = {};
    if (opts.amountPaise) body.amount = opts.amountPaise;
    if (opts.notes)       body.notes  = opts.notes;
    const auth = Buffer.from(`${creds.keyId}:${creds.secret}`).toString("base64");
    const resp = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method:  "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: data?.error?.description || `Razorpay refund failed (HTTP ${resp.status})` };
    }
    return { ok: true, id: data.id, status: data.status || "processed" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { refundPayment };
