'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-security-phone-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = 'platform';
process.env.ADMIN_PASSWORD = 'platform-secret';
process.env.ADMIN_TOKEN = '';

const app = require('../server');
const db = require('../src/db');

let server;
let baseUrl;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  const init = { ...options, headers };
  if (init.body && typeof init.body !== 'string') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function signup(email, businessName) {
  const result = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'correct-horse-1', businessName },
  });
  assert.equal(result.response.status, 201);
  return { ...result, cookie: cookieFrom(result.response), tenant: result.body.tenant };
}

async function authed(cookie, pathname, options = {}) {
  return request(pathname, {
    ...options,
    headers: { cookie, ...(options.headers || {}) },
  });
}

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('phone assignment routes are scoped to the acting tenant', async () => {
  const tenantA = await signup('phone-a@example.com', 'Phone Tenant A');
  const tenantB = await signup('phone-b@example.com', 'Phone Tenant B');
  db.assignTenantPhone(tenantA.tenant.id, '+15550001000');

  const duplicate = await authed(tenantB.cookie, '/api/phone/register', {
    method: 'POST',
    body: { phoneNumber: '+15550001000' },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.ok, false);
  assert.equal(duplicate.body.error.code, 'NUMBER_ALREADY_ASSIGNED');
  assert.equal(db.getTenantById(tenantA.tenant.id).twilio_phone_number, '+15550001000');
  assert.equal(db.getTenantById(tenantB.tenant.id).twilio_phone_number, null);

  const phoneB = await authed(tenantB.cookie, '/api/phone');
  assert.equal(phoneB.response.status, 200);
  assert.notEqual(phoneB.body.activeNumber, '+15550001000');
  assert.equal(phoneB.body.activeNumber, '');

  const unconfiguredAssign = await authed(tenantB.cookie, '/api/phone/register', {
    method: 'POST',
    body: { phoneNumber: '+15550002000' },
  });
  assert.equal(unconfiguredAssign.response.status, 503);
  assert.equal(unconfiguredAssign.body.ok, false);
  assert.equal(unconfiguredAssign.body.error.code, 'TWILIO_NOT_CONFIGURED');

  const unconfiguredProvision = await authed(tenantB.cookie, '/api/phone/provision', {
    method: 'POST',
    body: { areaCode: '415' },
  });
  assert.equal(unconfiguredProvision.response.status, 503);
  assert.equal(unconfiguredProvision.body.ok, false);
  assert.equal(unconfiguredProvision.body.error.code, 'TWILIO_NOT_CONFIGURED');

  assert.equal(db.getTenantById(tenantA.tenant.id).twilio_phone_number, '+15550001000');
  assert.equal(db.getTenantById(tenantB.tenant.id).twilio_phone_number, null);
});
