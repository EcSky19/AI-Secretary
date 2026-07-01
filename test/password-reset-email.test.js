'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-password-reset-email-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.SMTP_HOST = '';
process.env.SMTP_FROM = '';
process.env.EMAIL_FROM = '';

const db = require('../src/db');
const runtimeConfig = require('../src/runtime-config');
const email = require('../src/email');

let lastEmail = null;
email.isEmailEnabled = () => true;
email.sendEmail = async (to, subject, body) => {
  lastEmail = { to, subject, body };
  return { sent: true, id: 'MSG_TEST' };
};

const passwordReset = require('../src/password-reset');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function capturedCode() {
  assert.ok(lastEmail, 'expected reset email to be sent');
  const match = lastEmail.body.match(/code:\s*(\d{6})/);
  assert.ok(match, `expected email body to contain a six-digit code: ${lastEmail.body}`);
  return match[1];
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('email reset channel sends a code and changes the admin password once', async () => {
  runtimeConfig.setAdminCredentials({ user: 'admin', password: 'old' });
  runtimeConfig.setRecoveryEmail('owner@example.com');

  assert.deepEqual(passwordReset.emailAvailability(), { available: true, reason: 'ok' });
  const availability = passwordReset.resetAvailability();
  assert.equal(availability.channels.email.available, true);

  db.setSetting('admin_reset_last_sent', '0');
  const requested = await passwordReset.requestReset('email');
  assert.equal(requested.ok, true);
  assert.equal(requested.channel, 'email');
  assert.equal(requested.maskedTarget, runtimeConfig.maskEmail('owner@example.com'));
  assert.equal(lastEmail.to, 'owner@example.com');
  assert.match(lastEmail.subject, /password reset code/i);

  const code = capturedCode();
  assert.deepEqual(await passwordReset.verifyAndReset(code, 'newpass1'), { ok: true });
  assert.equal(runtimeConfig.verifyAdminLogin('admin', 'newpass1'), true);
  assert.equal(runtimeConfig.verifyAdminLogin('admin', 'old'), false);
  assert.deepEqual(await passwordReset.verifyAndReset(code, 'newpass2'), {
    ok: false,
    reason: 'no-code',
  });
});
