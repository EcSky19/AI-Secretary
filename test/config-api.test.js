'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-config-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';

const app = require('../server');

let server;
let baseUrl;
let currentPassword = 'secret1';

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function basicAuth(user = 'boss', password = currentPassword) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
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

async function authedRequest(pathname, options = {}) {
  return request(pathname, {
    ...options,
    headers: { authorization: basicAuth(), ...(options.headers || {}) },
  });
}

before(async () => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const setup = await request('/api/setup/profile', {
    method: 'POST',
    body: {
      businessName: 'Config Test Co',
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      appointmentLengthMinutes: 30,
      adminUser: 'boss',
      adminPassword: currentPassword,
    },
  });
  assert.equal(setup.response.status, 200);
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  const db = require('../src/db');
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('GET /api/config returns safe initial config without exposing raw Twilio token', async () => {
  const { response, body } = await authedRequest('/api/config');

  assert.equal(response.status, 200);
  assert.equal(body.businessName, 'Config Test Co');
  assert.equal(body.adminUser, 'boss');
  assert.equal(body.twilioConfigured, false);
  assert.equal(body.hasAuthToken, false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'authToken'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'twilioAuthToken'), false);
  assert.equal(typeof body.twilioAccountSid, 'string');
});

test('PUT /api/config/twilio saves credentials with live test skipped and never exposes token', async () => {
  const update = await authedRequest('/api/config/twilio', {
    method: 'PUT',
    body: {
      accountSid: 'AC00000000000000000000000000000000',
      authToken: 'faketoken',
      phoneNumber: '+15551230000',
      test: false,
    },
  });
  assert.equal(update.response.status, 200);
  assert.deepEqual(update.body, { ok: true, twilioConfigured: true, test: { ok: null } });

  const config = await authedRequest('/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.twilioConfigured, true);
  assert.equal(config.body.hasAuthToken, true);
  assert.equal(config.body.smsFromNumber, '+15551230000');
  assert.equal(config.body.twilioAccountSid, 'AC00000000000000000000000000000000');
  assert.equal(Object.prototype.hasOwnProperty.call(config.body, 'authToken'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config.body, 'twilioAuthToken'), false);
});

test('PUT /api/config/twilio rejects Account SIDs that do not start with AC', async () => {
  const { response, body } = await authedRequest('/api/config/twilio', {
    method: 'PUT',
    body: { accountSid: 'SK00000000000000000000000000000000', authToken: 'faketoken' },
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /accountSid/);
});

test('POST /api/config/twilio/test returns offline failure for invalid inline credentials', async () => {
  const { response, body } = await authedRequest('/api/config/twilio/test', {
    method: 'POST',
    body: { accountSid: 'not-an-account-sid', authToken: 'bad' },
  });

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
});

test('PUT /api/config/business updates business name', async () => {
  const update = await authedRequest('/api/config/business', {
    method: 'PUT',
    body: { businessName: 'New Name' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.ok, true);
  assert.equal(update.body.businessName, 'New Name');

  const config = await authedRequest('/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.businessName, 'New Name');
});

test('PUT /api/config/admin-password rejects too-short password', async () => {
  const { response, body } = await authedRequest('/api/config/admin-password', {
    method: 'PUT',
    body: { password: 'abc' },
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /password/);
});

test('PUT /api/config/admin-password changes the Basic auth password', async () => {
  const update = await authedRequest('/api/config/admin-password', {
    method: 'PUT',
    body: { password: 'newpass1' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.ok, true);
  currentPassword = 'newpass1';

  const newPassword = await request('/api/settings', {
    headers: { authorization: basicAuth('boss', 'newpass1') },
  });
  assert.equal(newPassword.response.status, 200);

  const oldPassword = await request('/api/settings', {
    headers: { authorization: basicAuth('boss', 'secret1') },
  });
  assert.equal(oldPassword.response.status, 401);
});
