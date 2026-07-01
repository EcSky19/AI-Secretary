'use strict';

const backups = require('../src/backups');

function usage() {
  console.log(`Usage:
  node scripts/restore.js <backup-file-name-or-path>

Restore overwrites the current SQLite database. Stop the app first, run this command, then restart the app.`);
}

function formatBytes(bytes) {
  return `${bytes} bytes`;
}

function printBackups(list) {
  if (!list.length) {
    console.log('No backups found.');
    return;
  }

  console.log('Available backups (newest first):');
  list.forEach((backup, index) => {
    console.log(`${index + 1}. ${backup.name}\t${backup.createdAt}\t${formatBytes(backup.size)}`);
  });
}

const target = process.argv[2];

if (!target || target === '--help' || target === '-h') {
  try {
    printBackups(backups.listBackups());
    console.log('');
    usage();
    process.exit(0);
  } catch (err) {
    console.error(`Could not list backups: ${err.message || 'Unexpected error.'}`);
    process.exit(1);
  }
}

try {
  console.log('WARNING: This restore OVERWRITES the current database.');
  console.log('Stop the app before restoring, and restart it after this command finishes.');
  const result = backups.restoreBackup(target);
  console.log('Restore completed successfully.');
  console.log(`Restored from: ${result.restoredFrom}`);
  console.log(`Database: ${result.to}`);
  console.log('Restart the app now so it opens the restored database.');
  process.exit(0);
} catch (err) {
  if (err.code === 'BACKUP_NOT_FOUND') {
    console.error(`Backup not found: ${target}`);
    console.error('Run node scripts/restore.js with no arguments to see available backups.');
  } else {
    console.error(`Restore failed: ${err.message || 'Unexpected error.'}`);
  }
  process.exit(1);
}
