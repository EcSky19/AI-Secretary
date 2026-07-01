'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-email-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';
process.env.SMTP_HOST = '';
process.env.SMTP_PORT = '';
process.env.SMTP_SECURE = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = '';
process.env.EMAIL_FROM = '';

const db = require('../src/db');
const runtimeConfig = require('../src/runtime-config');
const email = require('../src/email');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function resetEmailSettings() {
  for (const key of ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from']) {
    db.setSetting(key, '');
  }
}

beforeEach(() => {
  resetEmailSettings();
});

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('runtime email config persists and reports configured only with host and from', () => {
  runtimeConfig.setEmailConfig({
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'mailer',
    pass: 'secret',
    from: 'owner@example.com',
  });

  assert.deepEqual(runtimeConfig.getEmailConfig(), {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'mailer',
    pass: 'secret',
    from: 'owner@example.com',
  });
  assert.equal(runtimeConfig.isEmailConfigured(), true);

  runtimeConfig.setEmailConfig({ host: '' });
  assert.equal(runtimeConfig.isEmailConfigured(), false);
});

test('maskEmail reveals the first character and domain', () => {
  const masked = runtimeConfig.maskEmail('owner@example.com');
  assert.equal(masked.startsWith('o'), true);
  assert.equal(masked.includes('@example.com'), true);
  assert.equal(masked.includes('•'), true);
  assert.equal(runtimeConfig.maskEmail(''), '');
});

test('sendEmail gracefully reports missing recipient and missing SMTP config', async () => {
  assert.deepEqual(await email.sendEmail('', 'Subject', 'Body'), {
    sent: false,
    reason: 'no-recipient',
  });

  assert.deepEqual(await email.sendEmail('owner@example.com', 'Subject', 'Body'), {
    sent: false,
    reason: 'not-configured',
  });
});

test('testEmailConfig reports missing host/from without network access', async () => {
  const result = await email.testEmailConfig();
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
});
