'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-setup-forgot-email-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';
process.env.SMTP_HOST = '';
process.env.SMTP_FROM = '';
process.env.EMAIL_FROM = '';

const email = require('../src/email');
let lastEmail = null;
email.isEmailEnabled = () => true;
email.sendEmail = async (to, subject, body) => {
  lastEmail = { to, subject, body };
  return { sent: true, id: 'MSG_TEST' };
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
  assert.ok(lastEmail, 'expected reset email to be sent');
  const match = lastEmail.body.match(/code:\s*(\d{6})/);
  assert.ok(match, `expected email body to contain a six-digit code: ${lastEmail.body}`);
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
      recoveryEmail: 'owner@example.com',
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

test('email config endpoint stores SMTP settings without exposing plaintext password', async () => {
  const update = await request('/api/config/email', {
    method: 'PUT',
    headers: { authorization: basicAuth() },
    body: { host: 'smtp.x.com', from: 'a@x.com', pass: 'smtp-secret', test: false },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.ok, true);
  assert.equal(update.body.emailConfigured, true);

  const config = await request('/api/config', {
    headers: { authorization: basicAuth() },
  });
  assert.equal(config.response.status, 200);
  assert.equal(config.body.email.host, 'smtp.x.com');
  assert.equal(config.body.email.from, 'a@x.com');
  assert.equal(config.body.email.hasPassword, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config.body.email, 'pass'), false);
});

test('email forgot and reset endpoints send a code and update auth', async () => {
  const status = await request('/api/setup/reset-status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.channels.email.available, true);
  assert.equal(status.body.channels.email.reason, 'ok');

  const forgot = await request('/api/setup/forgot', {
    method: 'POST',
    body: { channel: 'email' },
  });
  assert.equal(forgot.response.status, 200);
  assert.equal(forgot.body.ok, true);
  assert.equal(forgot.body.channel, 'email');
  assert.equal(forgot.body.maskedTarget, 'o••••@example.com');
  assert.equal(lastEmail.to, 'owner@example.com');
  const code = capturedCode();

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
