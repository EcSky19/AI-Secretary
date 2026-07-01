'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-mt-numbers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

const db = require('../src/db');
let twilioNumbers = require('../src/twilio-numbers');

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

test('tenant phone assignment rejects numbers already owned by another tenant', () => {
  const tenantA = db.createTenant({ slug: 'number-tenant-a', businessName: 'Number Tenant A' });
  const tenantB = db.createTenant({ slug: 'number-tenant-b', businessName: 'Number Tenant B' });
  db.assignTenantPhone(tenantA.id, '+15556660001');

  assert.throws(
    () => db.assignTenantPhone(tenantB.id, '+15556660001'),
    (err) => /UNIQUE constraint failed: tenants\.twilio_phone_number/.test(err.message)
  );
  assert.equal(db.getTenantByPhone('+15556660001').id, tenantA.id);
});

test('provisioning helpers return structured errors without live Twilio credentials', async () => {
  const tenant = db.createTenant({ slug: 'offline-provisioning', businessName: 'Offline Provisioning' });

  const provisioned = await twilioNumbers.provisionNumberForTenant(tenant.id, { areaCode: '415' });
  assert.equal(provisioned.ok, false);
  assert.equal(provisioned.error.code, 'TWILIO_NOT_CONFIGURED');
  assert.match(provisioned.error.message, /Twilio is not configured/);

  const assigned = await twilioNumbers.assignExistingNumberToTenant(tenant.id, '+15557770001');
  assert.equal(assigned.ok, false);
  assert.equal(assigned.error.code, 'TWILIO_NOT_CONFIGURED');
  assert.match(assigned.error.message, /Twilio is not configured/);
});

test('assignExistingNumberToTenant rejects duplicate tenant ownership before any Twilio lookup', async () => {
  const tenantA = db.createTenant({ slug: 'function-number-a', businessName: 'Function Number A' });
  const tenantB = db.createTenant({ slug: 'function-number-b', businessName: 'Function Number B' });
  db.assignTenantPhone(tenantA.id, '+15558880001');

  process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
  process.env.TWILIO_AUTH_TOKEN = '00000000000000000000000000000000';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/runtime-config')];
  delete require.cache[require.resolve('../src/twilio-numbers')];
  twilioNumbers = require('../src/twilio-numbers');

  const result = await twilioNumbers.assignExistingNumberToTenant(tenantB.id, '+15558880001');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NUMBER_ALREADY_ASSIGNED');
  assert.match(result.error.message, /already assigned/);
  assert.equal(db.getTenantByPhone('+15558880001').id, tenantA.id);
});
