'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-phone-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';

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
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  const db = require('../src/db');
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('phone status endpoint reports unconfigured Twilio state', async () => {
  const { response, body } = await request('/api/phone');

  assert.equal(response.status, 200);
  assert.equal(body.configured, false);
  assert.equal(typeof body.webhookUrl, 'string');
});

test('phone management endpoints return 503 without Twilio credentials', async () => {
  const numbers = await request('/api/phone/numbers');
  assert.equal(numbers.response.status, 503);
  assert.ok(numbers.body.error);

  const register = await request('/api/phone/register', {
    method: 'POST',
    body: { phoneNumber: '+15551234567' },
  });
  assert.equal(register.response.status, 503);
  assert.ok(register.body.error);

  const available = await request('/api/phone/available?areaCode=415');
  assert.equal(available.response.status, 503);
  assert.ok(available.body.error);

  const provision = await request('/api/phone/provision', {
    method: 'POST',
    body: { phoneNumber: '+15551234567' },
  });
  assert.equal(provision.response.status, 503);
  assert.ok(provision.body.error);
});
