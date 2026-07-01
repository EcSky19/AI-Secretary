'use strict';

const backups = require('../src/backups');

function formatBytes(bytes) {
  return `${bytes} bytes`;
}

try {
  const result = backups.createBackup();
  console.log('Backup created successfully.');
  console.log(`File: ${result.file}`);
  console.log(`Size: ${formatBytes(result.size)}`);
  process.exit(0);
} catch (err) {
  console.error(`Backup failed: ${err.message || 'Unexpected error.'}`);
  process.exit(1);
}
