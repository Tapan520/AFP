// ?????????????????????????????????????????????????????????????????????????????
// storage/backup.js — MySQL backup helper.
//
// Uses `mysqldump` to produce a .sql file in BACKUP_DIR, optionally uploads
// the file to the configured cloud storage, and prunes files older than
// BACKUP_RETENTION_DAYS.
//
// A tiny in-memory scheduler is included so Super Admin can enable/disable
// daily automated backups at runtime without deploying. The next-run time is
// persisted in a small JSON file so it survives restarts.
// ?????????????????????????????????????????????????????????????????????????????
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");
const { getStorage } = require("./index");

const BACKUP_DIR   = path.resolve(__dirname, "..", process.env.BACKUP_DIR || "./backups");
const DUMP_CMD     = process.env.MYSQLDUMP_PATH || "mysqldump";
const UPLOAD_CLOUD = String(process.env.BACKUP_UPLOAD_TO_CLOUD || "false").toLowerCase() === "true";
const RETENTION    = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30);
const STATE_FILE   = path.join(BACKUP_DIR, ".schedule.json");

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function _timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function _dbCreds() {
  const url = process.env.DATABASE_URL;
  if (url && /^mysql/i.test(url)) {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port || "3306",
      user:     decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      database: (u.pathname || "").replace(/^\//, "") || "afp_nagarnigam",
    };
  }
  return {
    host:     process.env.MYSQL_HOST     || "localhost",
    port:     process.env.MYSQL_PORT     || "3306",
    user:     process.env.MYSQL_USER     || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "afp_nagarnigam",
  };
}

/**
 * Run mysqldump into BACKUP_DIR. Returns { file, sizeBytes, uploadedUrl? }.
 */
async function runBackup() {
  const creds    = _dbCreds();
  const filename = `afp-${creds.database}-${_timestamp()}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);
  const args     = [
    `--host=${creds.host}`,
    `--port=${creds.port}`,
    `--user=${creds.user}`,
    ...(creds.password ? [`--password=${creds.password}`] : []),
    "--single-transaction",
    "--quick",
    "--routines",
    "--events",
    "--set-gtid-purged=OFF",
    creds.database,
  ];

  await new Promise((resolve, reject) => {
    const out  = fs.createWriteStream(filepath);
    const dump = spawn(DUMP_CMD, args);
    dump.stdout.pipe(out);
    let stderr = "";
    dump.stderr.on("data", (d) => { stderr += d.toString(); });
    dump.on("error", reject);
    dump.on("close", (code) => {
      out.close();
      if (code === 0) return resolve();
      reject(new Error(`mysqldump exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });

  const stats = fs.statSync(filepath);
  const result = { file: filename, sizeBytes: stats.size, path: filepath };

  // Optional cloud upload
  if (UPLOAD_CLOUD) {
    try {
      const storage = getStorage();
      const buf = fs.readFileSync(filepath);
      const { url } = await storage.put(`backups/${filename}`, buf, "application/sql");
      result.uploadedUrl = url;
    } catch (err) {
      result.uploadError = err.message;
    }
  }

  // Retention prune
  try {
    const now = Date.now();
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".sql"));
    for (const f of files) {
      const abs = path.join(BACKUP_DIR, f);
      const s   = fs.statSync(abs);
      if ((now - s.mtimeMs) / 86_400_000 > RETENTION) {
        try { fs.unlinkSync(abs); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  return result;
}

/**
 * List existing local backups.
 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".sql"))
    .map(f => {
      const abs = path.join(BACKUP_DIR, f);
      const s   = fs.statSync(abs);
      return { file: f, sizeBytes: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupPath(file) {
  const safe = path.basename(file); // prevent traversal
  return path.join(BACKUP_DIR, safe);
}

// ?? Scheduler ???????????????????????????????????????????????????????????????
let _timer = null;
let _state = { enabled: false, hour: 2, minute: 30, lastRunAt: null, nextRunAt: null };

function _saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2)); } catch {}
}
function _loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      _state = { ..._state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
    }
  } catch {}
}
_loadState();

function _computeNextRun() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), _state.hour, _state.minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function _tick() {
  clearTimeout(_timer);
  if (!_state.enabled) { _state.nextRunAt = null; _saveState(); return; }
  const nextRun    = _computeNextRun();
  _state.nextRunAt = nextRun.toISOString();
  _saveState();
  const delay = Math.max(1000, nextRun.getTime() - Date.now());
  _timer = setTimeout(async () => {
    try {
      const r = await runBackup();
      _state.lastRunAt = new Date().toISOString();
      console.log("? Scheduled backup written:", r.file);
    } catch (err) {
      console.error("Scheduled backup failed:", err.message);
    } finally {
      _tick(); // schedule the next one
    }
  }, delay);
}

function getSchedule() {
  return { ..._state, retentionDays: RETENTION, uploadToCloud: UPLOAD_CLOUD };
}

function setSchedule({ enabled, hour, minute }) {
  if (typeof enabled === "boolean") _state.enabled = enabled;
  if (Number.isInteger(hour)   && hour   >= 0 && hour   < 24) _state.hour   = hour;
  if (Number.isInteger(minute) && minute >= 0 && minute < 60) _state.minute = minute;
  _tick();
  return getSchedule();
}

// Auto-resume scheduling on module load (if it was enabled before restart)
_tick();

module.exports = { runBackup, listBackups, backupPath, getSchedule, setSchedule, BACKUP_DIR };
