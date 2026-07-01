'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-setup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function basicAuth(user = 'boss', password = 'secret1') {
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

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  const db = require('../src/db');
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('setup status starts incomplete and API is open before onboarding', async () => {
  const status = await request('/api/setup/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.setupComplete, false);

  const settings = await request('/api/settings');
  assert.equal(settings.response.status, 200);
});

test('setup profile validation rejects missing business name and short admin password', async () => {
  const missingName = await request('/api/setup/profile', {
    method: 'POST',
    body: { adminUser: 'boss', adminPassword: 'secret1' },
  });
  assert.equal(missingName.response.status, 400);
  assert.match(missingName.body.error, /businessName/);

  const shortPassword = await request('/api/setup/profile', {
    method: 'POST',
    body: { businessName: 'AI Scheduler', adminUser: 'boss', adminPassword: 'abc' },
  });
  assert.equal(shortPassword.response.status, 400);
  assert.match(shortPassword.body.error, /adminPassword/);
});

test('valid setup profile completes onboarding and applies profile settings', async () => {
  const setup = await request('/api/setup/profile', {
    method: 'POST',
    body: {
      businessName: 'AI Scheduler',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      appointmentLengthMinutes: 60,
      adminUser: 'boss',
      adminPassword: 'secret1',
    },
  });
  assert.equal(setup.response.status, 200);
  assert.equal(setup.body.ok, true);
  assert.equal(setup.body.authRequired, true);

  const status = await request('/api/setup/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.setupComplete, true);
  assert.equal(status.body.businessName, 'AI Scheduler');

  const settings = await request('/api/settings', {
    headers: { authorization: basicAuth() },
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.body.businessHoursStart, '08:00');
  assert.equal(settings.body.businessHoursEnd, '18:00');
  assert.equal(settings.body.appointmentLengthMinutes, 60);
});

test('API requires correct Basic auth after setup', async () => {
  const noAuth = await request('/api/settings');
  assert.equal(noAuth.response.status, 401);

  const wrongPassword = await request('/api/settings', {
    headers: { authorization: basicAuth('boss', 'wrong') },
  });
  assert.equal(wrongPassword.response.status, 401);

  const correct = await request('/api/settings', {
    headers: { authorization: basicAuth() },
  });
  assert.equal(correct.response.status, 200);
});

test('setup profile cannot run a second time', async () => {
  const again = await request('/api/setup/profile', {
    method: 'POST',
    body: { businessName: 'Other', adminUser: 'boss', adminPassword: 'secret1' },
  });
  assert.equal(again.response.status, 409);
});
