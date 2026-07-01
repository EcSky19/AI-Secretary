'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-password-reset-env-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'envpass';
process.env.ADMIN_TOKEN = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

const db = require('../src/db');
const runtimeConfig = require('../src/runtime-config');
const notify = require('../src/notify');

notify.isSmsEnabled = () => true;
notify.sendSms = async () => ({ sent: true, sid: 'SM_TEST' });

const passwordReset = require('../src/password-reset');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('environment-managed admin passwords disable SMS reset', async () => {
  runtimeConfig.setAdminCredentials({ user: 'admin', password: 'dbpass1' });
  runtimeConfig.setRecoveryPhone('+15551234567');

  assert.equal(runtimeConfig.isPasswordEnvManaged(), true);
  assert.deepEqual(passwordReset.resetAvailability(), {
    available: false,
    reason: 'env-managed',
    channels: {
      sms: { available: false, reason: 'env-managed' },
      email: { available: false, reason: 'env-managed' },
    },
  });
  assert.deepEqual(await passwordReset.verifyAndReset('123456', 'whatever1'), {
    ok: false,
    reason: 'env-managed',
  });
});
