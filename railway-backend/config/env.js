// ?????????????????????????????????????????????????????????????????????????????
// config/env.js — Environment loader + validator.
//
// Loads variables in this order:
//   1. .env.<NODE_ENV>   (e.g. .env.development or .env.production)
//   2. .env              (fallback / overrides)
//
// Then runs `dotenv-safe` against `.env.example` to guarantee every REQUIRED
// variable is present. If any are missing, the process exits with a clear
// message *before* the server ever starts listening.
//
// Additional runtime guards (that dotenv-safe alone can't express):
//   • In production, JWT_SECRET must be ? 32 chars and not equal the dev value.
//   • In production, MIGRATION_SECRET must be set and not equal the dev value.
//
// Require this module BEFORE anything that reads process.env.
// ?????????????????????????????????????????????????????????????????????????????
const path      = require("path");
const fs        = require("fs");
const dotenv    = require("dotenv");
const dotenvSafe = require("dotenv-safe");

const ROOT       = path.resolve(__dirname, "..");
const NODE_ENV   = process.env.NODE_ENV || "development";
const envFile    = path.join(ROOT, `.env.${NODE_ENV}`);
const fallback   = path.join(ROOT, ".env");
const example    = path.join(ROOT, ".env.example");

// Load environment-specific file first (does not overwrite existing vars).
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}
// Load .env last as a fallback (also does not overwrite).
if (fs.existsSync(fallback)) {
  dotenv.config({ path: fallback });
}

// Validate that every variable listed in .env.example is present.
try {
  dotenvSafe.config({
    example,
    allowEmptyValues: true, // presence is enough; specific vars are checked below
    path:             fs.existsSync(envFile) ? envFile : fallback,
  });
} catch (err) {
  console.error("\n? Environment validation failed:");
  console.error(err.message || err);
  console.error(`\nCreate/update your .env.${NODE_ENV} file using .env.example as a reference.\n`);
  process.exit(1);
}

// Production-only extra checks.
if (NODE_ENV === "production") {
  const DEV_SECRETS = new Set([
    "afp_local_dev_secret_key_change_in_production_32chars",
    "change_me_to_a_long_random_string_at_least_32_chars",
    "afp-migrate-2026",
    "change_me_for_run_migrations_endpoint",
  ]);
  const errs = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errs.push("JWT_SECRET must be at least 32 characters in production.");
  }
  if (DEV_SECRETS.has(process.env.JWT_SECRET)) {
    errs.push("JWT_SECRET is still the dev default — rotate it before deploying.");
  }
  if (!process.env.MIGRATION_SECRET) {
    errs.push("MIGRATION_SECRET must be set in production.");
  }
  if (DEV_SECRETS.has(process.env.MIGRATION_SECRET)) {
    errs.push("MIGRATION_SECRET is still the dev default — rotate it before deploying.");
  }
  if (!process.env.DATABASE_URL && !process.env.MYSQL_HOST) {
    errs.push("Either DATABASE_URL or MYSQL_HOST must be set in production.");
  }
  if (errs.length) {
    console.error("\n? Production environment checks failed:");
    for (const e of errs) console.error("  • " + e);
    console.error("");
    process.exit(1);
  }
}

console.log(`? Environment loaded (${NODE_ENV})`);

module.exports = { NODE_ENV };
