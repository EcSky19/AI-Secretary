'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-runtime-config-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';

const runtimeConfig = require('../src/runtime-config');
const db = require('../src/db');

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

test('Twilio credentials start empty, persist, and report configured with valid Account SID', () => {
  assert.deepEqual(runtimeConfig.getTwilioCredentials(), {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });
  assert.equal(runtimeConfig.isTwilioConfigured(), false);

  runtimeConfig.setTwilioCredentials({
    accountSid: 'AC00000000000000000000000000000000',
    authToken: 'x',
    phoneNumber: '+15551230000',
  });

  assert.deepEqual(runtimeConfig.getTwilioCredentials(), {
    accountSid: 'AC00000000000000000000000000000000',
    authToken: 'x',
    phoneNumber: '+15551230000',
  });
  assert.equal(runtimeConfig.isTwilioConfigured(), true);
});

test('Twilio is not configured when Account SID does not start with AC', () => {
  runtimeConfig.setTwilioCredentials({ accountSid: 'SK00000000000000000000000000000000', authToken: 'x' });
  assert.equal(runtimeConfig.isTwilioConfigured(), false);
});

test('credential change listeners fire after Twilio credentials are updated', () => {
  let calls = 0;
  runtimeConfig.onCredentialsChange(() => {
    calls += 1;
  });

  runtimeConfig.setTwilioCredentials({ authToken: 'changed' });

  assert.equal(calls, 1);
});

test('business name defaults and persists after update', () => {
  assert.equal(runtimeConfig.getBusinessName(), 'AI Secretary');

  runtimeConfig.setBusinessName('Front Desk Co');

  assert.equal(runtimeConfig.getBusinessName(), 'Front Desk Co');
});

test('admin credentials enable auth, verify logins, and store only a scrypt hash', () => {
  assert.equal(runtimeConfig.isAuthConfigured(), false);

  runtimeConfig.setAdminCredentials({ user: 'boss', password: 'secret1' });

  assert.equal(runtimeConfig.isAuthConfigured(), true);
  assert.equal(runtimeConfig.verifyAdminLogin('boss', 'secret1'), true);
  assert.equal(runtimeConfig.verifyAdminLogin('boss', 'wrong'), false);
  assert.equal(runtimeConfig.verifyAdminLogin('admin', 'secret1'), false);

  const storedHash = db.getSetting('admin_password_hash');
  assert.match(storedHash, /^scrypt\$/);
  assert.equal(storedHash.includes('secret1'), false);
});

test('setup completion state and status expose documented keys', () => {
  assert.equal(runtimeConfig.isSetupComplete(), false);

  runtimeConfig.markSetupComplete();

  assert.equal(runtimeConfig.isSetupComplete(), true);
  const status = runtimeConfig.getSetupStatus();
  assert.deepEqual(Object.keys(status).sort(), [
    'adminConfigured',
    'businessName',
    'passwordEnvManaged',
    'publicBaseUrl',
    'recoveryPhoneSet',
    'setupComplete',
    'smsFromNumber',
    'twilioConfigured',
    'usingLocalhost',
  ]);
  assert.equal(status.setupComplete, true);
  assert.equal(status.businessName, 'Front Desk Co');
  assert.equal(status.adminConfigured, true);
  assert.equal(typeof status.smsFromNumber, 'string');
  assert.equal(typeof status.publicBaseUrl, 'string');
  assert.equal(typeof status.usingLocalhost, 'boolean');
});

test('invalid Twilio credential test returns a graceful failure without throwing', async () => {
  const invalidSid = await runtimeConfig.testTwilioCredentials({
    accountSid: 'not-an-account-sid',
    authToken: 'x',
  });
  assert.equal(invalidSid.ok, false);
  assert.equal(typeof invalidSid.error, 'string');

  const empty = await runtimeConfig.testTwilioCredentials({ accountSid: '', authToken: '' });
  assert.equal(empty.ok, false);
  assert.equal(typeof empty.error, 'string');
});
