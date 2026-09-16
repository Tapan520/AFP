// ?????????????????????????????????????????????????????????????????????????????
// routes/adminBackups.js — Super Admin backup management
//
// GET    /api/admin/backups           list existing dumps
// POST   /api/admin/backups           run a fresh dump right now
// GET    /api/admin/backups/schedule  view the schedule
// PUT    /api/admin/backups/schedule  enable/disable + set time
// GET    /api/admin/backups/:file     download a specific dump
// DELETE /api/admin/backups/:file     delete a specific dump
// ?????????????????????????????????????????????????????????????????????????????
const fs         = require("fs");
const express    = require("express");
const { authenticate, requireRole } = require("../middleware/auth");
const backups    = require("../storage/backup");

const router = express.Router();
router.use(authenticate, requireRole("super_admin"));

router.get("/", (_req, res) => {
  try { res.json(backups.listBackups()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/", async (_req, res) => {
  try { res.json(await backups.runBackup()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/schedule", (_req, res) => res.json(backups.getSchedule()));

router.put("/schedule", (req, res) => {
  try {
    const { enabled, hour, minute } = req.body || {};
    res.json(backups.setSchedule({ enabled, hour, minute }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get("/:file", (req, res) => {
  const p = backups.backupPath(req.params.file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Backup not found." });
  res.download(p);
});

router.delete("/:file", (req, res) => {
  const p = backups.backupPath(req.params.file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Backup not found." });
  try { fs.unlinkSync(p); res.json({ deleted: req.params.file }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
