// ─────────────────────────────────────────────────────────────────────────────
// utils/email.js — Thin nodemailer wrapper with graceful no-op fallback.
//
// Uses SMTP_* env vars. If SMTP_HOST is not configured (or nodemailer is not
// installed), sendEmail() logs to console and resolves without throwing so the
// caller (approve/reject flow) never breaks a request just because SMTP is down.
//
//   SMTP_HOST     — e.g. smtp.gmail.com
//   SMTP_PORT     — 587 (STARTTLS) or 465 (SSL). Defaults to 587.
//   SMTP_USER     — auth username
//   SMTP_PASS     — auth password / app password
//   SMTP_FROM     — "From" header (defaults to `no-reply@allforpets.gov.in`)
//   SMTP_SECURE   — "true" to force TLS on 465
// ─────────────────────────────────────────────────────────────────────────────

let _transporter = null;
let _initialized = false;

function _init() {
  if (_initialized) return _transporter;
  _initialized = true;
  if (!process.env.SMTP_HOST) return null;
  try {
    // Lazy require so the dep is optional at install-time.
    const nodemailer = require("nodemailer");
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   +(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true"
              || +(process.env.SMTP_PORT || 0) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    console.log(`✔ SMTP configured (host=${process.env.SMTP_HOST})`);
  } catch (err) {
    console.warn(`⚠ nodemailer unavailable — email notifications disabled: ${err.message}`);
    _transporter = null;
  }
  return _transporter;
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { skipped: true, reason: "no recipient" };
  const t = _init();
  if (!t) {
    console.log(`[email:noop] to=${to} subject="${subject}"`);
    return { skipped: true, reason: "SMTP not configured" };
  }
  try {
    const info = await t.sendMail({
      from:    process.env.SMTP_FROM || "no-reply@allforpets.gov.in",
      to, subject, text, html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email:error] to=${to} — ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { sendEmail };
