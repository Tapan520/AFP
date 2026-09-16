// ─────────────────────────────────────────────────────────────────────────────
// config/env.js — Environment loader + validator.
//
// Loading order (later files DO NOT overwrite already-set vars):
//   1. Vars already present in process.env (Railway / host injects these).
//   2. .env.<NODE_ENV>   (e.g. .env.development, .env.production)
//   3. .env              (final fallback)
//
// Validation is INTENTIONALLY minimal — only truly required keys are checked.
// Optional cloud-provider keys (S3 / Azure / Cloudinary / backups) are only
// required when the matching STORAGE_PROVIDER is selected. This keeps single-
// provider deploys (e.g. Cloudinary-only) from crashing on missing S3 vars.
//
// Require this module BEFORE anything that reads process.env.
// ─────────────────────────────────────────────────────────────────────────────
const path   = require("path");
const fs     = require("fs");
const dotenv = require("dotenv");

const ROOT     = path.resolve(__dirname, "..");
const NODE_ENV = process.env.NODE_ENV || "development";
const envFile  = path.join(ROOT, `.env.${NODE_ENV}`);
const fallback = path.join(ROOT, ".env");

if (fs.existsSync(envFile))  dotenv.config({ path: envFile });
if (fs.existsSync(fallback)) dotenv.config({ path: fallback });

// ── Required (regardless of environment) ────────────────────────────────────
const REQUIRED_ALWAYS = ["JWT_SECRET"];

function hasDb() {
  return !!(process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_HOST);
}

function providerRequirements() {
  const p = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  switch (p) {
    case "s3":         return ["AWS_REGION", "S3_BUCKET"];
    case "azure":      return ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_BLOB_CONTAINER"];
    case "cloudinary": return ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
    default:           return []; // local
  }
}

const missing = [];
for (const k of REQUIRED_ALWAYS) if (!process.env[k]) missing.push(k);
for (const k of providerRequirements()) if (!process.env[k]) missing.push(k);
if (!hasDb()) missing.push("DATABASE_URL (or MYSQL_URL / MYSQL_HOST+MYSQL_USER+MYSQL_PASSWORD+MYSQL_DATABASE)");

if (missing.length) {
  console.error("\n❌ Environment validation failed. Missing required variables:");
  for (const k of missing) console.error("  • " + k);
  console.error(`\nSet them in the Railway service Variables tab (or in .env.${NODE_ENV} locally).\n`);
  process.exit(1);
}

// ── Production-only extra guards ────────────────────────────────────────────
if (NODE_ENV === "production") {
  const DEV_SECRETS = new Set([
    "afp_local_dev_secret_key_change_in_production_32chars",
    "change_me_to_a_long_random_string_at_least_32_chars",
    "afp-migrate-2026",
    "change_me_for_run_migrations_endpoint",
  ]);
  const errs = [];
  if (process.env.JWT_SECRET.length < 32) {
    errs.push("JWT_SECRET must be at least 32 characters in production.");
  }
  if (DEV_SECRETS.has(process.env.JWT_SECRET)) {
    errs.push("JWT_SECRET is still the dev default — rotate it before deploying.");
  }
  if (process.env.MIGRATION_SECRET && DEV_SECRETS.has(process.env.MIGRATION_SECRET)) {
    errs.push("MIGRATION_SECRET is still the dev default — rotate it before deploying.");
  }
  if (errs.length) {
    console.error("\n❌ Production environment checks failed:");
    for (const e of errs) console.error("  • " + e);
    console.error("");
    process.exit(1);
  }
}

console.log(`✔ Environment loaded (${NODE_ENV})`);
console.log(`✔ Storage provider: ${(process.env.STORAGE_PROVIDER || "local").toLowerCase()}`);

module.exports = { NODE_ENV };
