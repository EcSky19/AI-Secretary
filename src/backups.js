'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---------------------------------------------------------------------------
// Database backups
//
// The whole business (appointments, settings, credentials) lives in a single
// SQLite file, so losing it is catastrophic for a small trade business. This
// module makes timestamped copies of that file on a schedule and on demand,
// keeps a bounded number of them, and can restore one. Uses SQLite's online
// backup-safe approach (VACUUM INTO) so copies are consistent even while the
// app is running.
// ---------------------------------------------------------------------------

let timer = null;

function getBackupsDir() {
  if (config.backups.dir) return config.backups.dir;
  return path.join(path.dirname(config.databasePath), 'backups');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// Create a consistent backup copy. Returns { file, size, createdAt }.
function createBackup() {
  const dir = getBackupsDir();
  ensureDir(dir);
  const file = path.join(dir, `secretary-${timestamp()}.db`);

  // Require db lazily so this module can be used by CLIs without side effects
  // beyond opening the same database the app uses.
  // eslint-disable-next-line global-require
  const { db } = require('./db');
  // VACUUM INTO writes a fully consistent snapshot to a new file.
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  pruneBackups();
  const stat = fs.statSync(file);
  return { file, size: stat.size, createdAt: stat.mtime.toISOString() };
}

// List existing backups, newest first.
function listBackups() {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^secretary-.*\.db$/.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, file: full, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Delete oldest backups beyond the configured retention count.
function pruneBackups() {
  const keep = config.backups.keep;
  if (!keep || keep < 1) return;
  const backups = listBackups();
  for (const old of backups.slice(keep)) {
    try {
      fs.unlinkSync(old.file);
    } catch (err) {
      console.error('backup prune failed:', err.message);
    }
  }
}

// Restore a backup by absolute path or by bare filename inside the backups dir.
// Overwrites the live database file. The caller is responsible for restarting
// the app afterwards so it reopens the restored file.
function restoreBackup(target) {
  const dir = getBackupsDir();
  const src = path.isAbsolute(target) ? target : path.join(dir, target);
  if (!fs.existsSync(src)) {
    const err = new Error(`Backup not found: ${target}`);
    err.code = 'BACKUP_NOT_FOUND';
    throw err;
  }
  ensureDir(path.dirname(config.databasePath));
  fs.copyFileSync(src, config.databasePath);
  return { restoredFrom: src, to: config.databasePath };
}

function startBackups() {
  if (timer || !config.backups.enabled) return;
  const intervalMs = Math.max(0.05, config.backups.intervalHours) * 60 * 60 * 1000;
  timer = setInterval(() => {
    try {
      createBackup();
    } catch (err) {
      console.error('scheduled backup failed:', err.message);
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
}

function stopBackups() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  getBackupsDir,
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  startBackups,
  stopBackups,
};
