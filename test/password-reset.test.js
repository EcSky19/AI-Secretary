'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-password-reset-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

const db = require('../src/db');
const runtimeConfig = require('../src/runtime-config');
const notify = require('../src/notify');

let lastSms = null;
notify.isSmsEnabled = () => true;
notify.sendSms = async (to, body) => {
  lastSms = { to, body };
  return { sent: true, sid: 'SM_TEST' };
};

const passwordReset = require('../src/password-reset');
const { MAX_ATTEMPTS } = passwordReset;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function resetSettings() {
  for (const key of [
    'admin_user',
    'admin_password_hash',
    'recovery_phone',
    'business_name',
    'admin_reset_code_hash',
    'admin_reset_expires',
    'admin_reset_attempts',
    'admin_reset_last_sent',
  ]) {
    db.setSetting(key, '');
  }
  lastSms = null;
  notify.isSmsEnabled = () => true;
}

function configureResetReady() {
  runtimeConfig.setBusinessName('Test Secretary');
  runtimeConfig.setAdminCredentials({ user: 'admin', password: 'old' });
  runtimeConfig.setRecoveryPhone('+15551234567');
}

function capturedCode() {
  assert.ok(lastSms, 'expected reset SMS to be sent');
  const match = lastSms.body.match(/code:\s*(\d{6})/);
  assert.ok(match, `expected SMS body to contain a six-digit code: ${lastSms.body}`);
  return match[1];
}

async function requestFreshReset() {
  db.setSetting('admin_reset_last_sent', '0');
  const result = await passwordReset.requestReset();
  assert.equal(result.ok, true);
  return capturedCode();
}

beforeEach(() => {
  resetSettings();
});

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('resetAvailability reports each unavailable reason and the available state', () => {
  let availability = passwordReset.resetAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.reason, 'not-configured');
  assert.deepEqual(availability.channels.sms, { available: false, reason: 'not-configured' });
  assert.deepEqual(passwordReset.smsAvailability(), { available: false, reason: 'not-configured' });

  runtimeConfig.setAdminCredentials({ user: 'admin', password: 'old' });
  availability = passwordReset.resetAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.reason, 'no-channel');
  assert.deepEqual(availability.channels.sms, { available: false, reason: 'no-recovery-phone' });
  assert.deepEqual(passwordReset.smsAvailability(), { available: false, reason: 'no-recovery-phone' });

  runtimeConfig.setRecoveryPhone('+15551234567');
  notify.isSmsEnabled = () => false;
  availability = passwordReset.resetAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.reason, 'no-channel');
  assert.deepEqual(availability.channels.sms, { available: false, reason: 'sms-unavailable' });
  assert.deepEqual(passwordReset.smsAvailability(), { available: false, reason: 'sms-unavailable' });

  notify.isSmsEnabled = () => true;
  availability = passwordReset.resetAvailability();
  assert.equal(availability.available, true);
  assert.equal(availability.reason, 'ok');
  assert.deepEqual(availability.channels.sms, { available: true, reason: 'ok' });
});

test('requestReset sends a code and verifyAndReset changes the admin password once', async () => {
  configureResetReady();

  const result = await passwordReset.requestReset();
  assert.equal(result.ok, true);
  assert.equal(result.maskedPhone, '••• ••• 4567');
  assert.equal(lastSms.to, '+15551234567');

  const code = capturedCode();
  assert.match(lastSms.body, /\b\d{6}\b/);

  assert.deepEqual(await passwordReset.verifyAndReset(code, 'newpass1'), { ok: true });
  assert.equal(runtimeConfig.verifyAdminLogin('admin', 'old'), false);
  assert.equal(runtimeConfig.verifyAdminLogin('admin', 'newpass1'), true);

  assert.deepEqual(await passwordReset.verifyAndReset(code, 'other1'), {
    ok: false,
    reason: 'no-code',
  });
});

test('wrong codes decrement attempts and eventually clear reset state', async () => {
  configureResetReady();
  await requestFreshReset();

  const firstWrong = await passwordReset.verifyAndReset('000000', 'newpass1');
  assert.equal(firstWrong.ok, false);
  assert.equal(firstWrong.reason, 'invalid-code');
  assert.equal(firstWrong.attemptsLeft, MAX_ATTEMPTS - 1);

  for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
    const wrong = await passwordReset.verifyAndReset('000000', 'newpass1');
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, 'invalid-code');
    assert.equal(wrong.attemptsLeft, MAX_ATTEMPTS - (i + 1));
  }

  assert.deepEqual(await passwordReset.verifyAndReset('000000', 'newpass1'), {
    ok: false,
    reason: 'too-many-attempts',
  });
  assert.deepEqual(await passwordReset.verifyAndReset('000000', 'newpass1'), {
    ok: false,
    reason: 'no-code',
  });
});

test('weak new passwords are rejected before consuming a valid code', async () => {
  configureResetReady();
  const code = await requestFreshReset();

  assert.deepEqual(await passwordReset.verifyAndReset(code, 'short'), {
    ok: false,
    reason: 'weak-password',
  });

  assert.deepEqual(await passwordReset.verifyAndReset(code, 'strong1'), { ok: true });
});

test('expired reset codes are rejected and cleared', async () => {
  configureResetReady();
  const code = await requestFreshReset();
  db.setSetting('admin_reset_expires', String(Date.now() - 1000));

  assert.deepEqual(await passwordReset.verifyAndReset(code, 'newpass1'), {
    ok: false,
    reason: 'expired',
  });
  assert.deepEqual(await passwordReset.verifyAndReset(code, 'newpass1'), {
    ok: false,
    reason: 'no-code',
  });
});

test('requestReset enforces resend cooldown', async () => {
  configureResetReady();
  const first = await passwordReset.requestReset();
  assert.equal(first.ok, true);

  const second = await passwordReset.requestReset();
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'cooldown');
  assert.equal(typeof second.retryAfter, 'number');
  assert.ok(second.retryAfter > 0);
});
