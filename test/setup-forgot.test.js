'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-setup-forgot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';

const notify = require('../src/notify');
let lastSms = null;
notify.isSmsEnabled = () => true;
notify.sendSms = async (to, body) => {
  lastSms = { to, body };
  return { sent: true, sid: 'SM_TEST' };
};

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

function basicAuth(user = 'admin', password = 'secret1') {
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

function capturedCode() {
  assert.ok(lastSms, 'expected reset SMS to be sent');
  const match = lastSms.body.match(/code:\s*(\d{6})/);
  assert.ok(match, `expected SMS body to contain a six-digit code: ${lastSms.body}`);
  return match[1];
}

before(async () => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const setup = await request('/api/setup/profile', {
    method: 'POST',
    body: {
      businessName: 'AI Scheduler',
      adminUser: 'admin',
      adminPassword: 'secret1',
      recoveryPhone: '+15551234567',
    },
  });
  assert.equal(setup.response.status, 200);
  assert.equal(setup.body.ok, true);
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('reset-status reports SMS reset is available', async () => {
  const status = await request('/api/setup/reset-status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.available, true);
  assert.equal(status.body.reason, 'ok');
});

test('forgot and reset endpoints reject wrong code, accept real code, and update auth', async () => {
  const forgot = await request('/api/setup/forgot', { method: 'POST', body: {} });
  assert.equal(forgot.response.status, 200);
  assert.equal(forgot.body.ok, true);
  assert.equal(forgot.body.maskedPhone, '••• ••• 4567');
  assert.equal(lastSms.to, '+15551234567');
  const code = capturedCode();

  const wrong = await request('/api/setup/reset', {
    method: 'POST',
    body: { code: '000000', newPassword: 'brandnew1' },
  });
  assert.equal(wrong.response.status, 400);
  assert.equal(wrong.body.ok, false);
  assert.equal(wrong.body.reason, 'invalid-code');

  const reset = await request('/api/setup/reset', {
    method: 'POST',
    body: { code, newPassword: 'brandnew1' },
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.body.ok, true);

  const newPassword = await request('/api/config', {
    headers: { authorization: basicAuth('admin', 'brandnew1') },
  });
  assert.equal(newPassword.response.status, 200);

  const oldPassword = await request('/api/config', {
    headers: { authorization: basicAuth('admin', 'secret1') },
  });
  assert.equal(oldPassword.response.status, 401);
});

test('forgot endpoint returns HTTP 429 during cooldown', async () => {
  const forgot = await request('/api/setup/forgot', { method: 'POST', body: {} });
  assert.equal(forgot.response.status, 429);
  assert.equal(forgot.body.ok, false);
  assert.equal(forgot.body.reason, 'cooldown');
});
