'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const testId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const testDbPath = path.join(__dirname, `.secretary-backups-${testId}.db`);
const backupDir = path.join(__dirname, `.secretary-backups-${testId}`);
process.env.DATABASE_PATH = testDbPath;
process.env.BACKUP_DIR = backupDir;
process.env.BACKUP_KEEP = '2';

const db = require('../src/db');
const backups = require('../src/backups');
const config = require('../src/config');

let firstBackup;
let dbClosed = false;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function removeDirIfExists(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

after(() => {
  if (!dbClosed) db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
  removeDirIfExists(backupDir);
});

test('createBackup returns metadata, lists the backup, and produces a valid SQLite copy', () => {
  db.bookAppointment({
    name: 'Backup Patient',
    phone: '+15550000001',
    reason: 'Backup verification',
    startISO: '2035-01-01T09:00',
    endISO: '2035-01-01T09:30',
  });

  firstBackup = backups.createBackup();
  assert.equal(typeof firstBackup.file, 'string');
  assert.ok(fs.existsSync(firstBackup.file));
  assert.ok(firstBackup.size > 0);
  assert.ok(Date.parse(firstBackup.createdAt));

  const listed = backups.listBackups();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, path.basename(firstBackup.file));
  assert.match(listed[0].name, /^secretary-.*\.db$/);
  assert.ok(listed[0].size > 0);
  assert.ok(Date.parse(listed[0].createdAt));

  const backupDb = new DatabaseSync(firstBackup.file);
  try {
    const settings = backupDb.prepare('SELECT COUNT(*) AS count FROM settings').get();
    assert.ok(settings.count > 0);
    const appt = backupDb
      .prepare('SELECT COUNT(*) AS count FROM appointments WHERE name = ?')
      .get('Backup Patient');
    assert.equal(appt.count, 1);
  } finally {
    backupDb.close();
  }
});

test('restoreBackup overwrites the live database and reports missing backups', () => {
  assert.ok(firstBackup, 'createBackup test must run first');
  db.bookAppointment({
    name: 'Post Backup Patient',
    phone: '+15550000002',
    reason: 'Should be removed by restore',
    startISO: '2035-01-01T10:00',
    endISO: '2035-01-01T10:30',
  });

  db.db.close();
  dbClosed = true;

  const restored = backups.restoreBackup(path.basename(firstBackup.file));
  assert.equal(restored.to, config.databasePath);
  assert.equal(restored.restoredFrom, firstBackup.file);

  const restoredDb = new DatabaseSync(config.databasePath);
  try {
    const kept = restoredDb
      .prepare('SELECT COUNT(*) AS count FROM appointments WHERE name = ?')
      .get('Backup Patient');
    const removed = restoredDb
      .prepare('SELECT COUNT(*) AS count FROM appointments WHERE name = ?')
      .get('Post Backup Patient');
    assert.equal(kept.count, 1);
    assert.equal(removed.count, 0);
  } finally {
    restoredDb.close();
  }

  assert.throws(() => backups.restoreBackup('does-not-exist.db'), {
    code: 'BACKUP_NOT_FOUND',
  });
});

test('pruneBackups keeps only the configured number of newest backup files', () => {
  removeDirIfExists(backupDir);
  fs.mkdirSync(backupDir, { recursive: true });
  const names = [
    'secretary-20000101-000000.db',
    'secretary-20000101-000001.db',
    'secretary-20000101-000002.db',
  ];
  names.forEach((name, index) => {
    const file = path.join(backupDir, name);
    fs.writeFileSync(file, `backup-${index}`);
    const mtime = new Date(Date.UTC(2030, 0, 1, 0, 0, index));
    fs.utimesSync(file, mtime, mtime);
  });

  backups.pruneBackups();
  const listed = backups.listBackups();
  assert.equal(listed.length, 2);
  assert.deepEqual(
    listed.map((b) => b.name),
    ['secretary-20000101-000002.db', 'secretary-20000101-000001.db']
  );
});
