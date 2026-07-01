'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-export-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'export-secret';
process.env.ADMIN_TOKEN = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

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

function authHeader() {
  return `Basic ${Buffer.from('admin:export-secret').toString('base64')}`;
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
  return { response, text };
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

test('appointments export requires auth and emits escaped CSV rows', async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/appointments/export.csv`);
  assert.equal(unauthenticated.status, 401);

  const created = await request('/api/appointments', {
    method: 'POST',
    headers: { authorization: authHeader() },
    body: {
      name: 'Doe, Jane "JJ"',
      phone: '+15550001234',
      reason: 'Quote "review"',
      date: '2036-06-01',
      time: '09:00',
    },
  });
  assert.equal(created.response.status, 201);

  const exported = await request('/api/appointments/export.csv?status=booked', {
    headers: { authorization: authHeader() },
  });
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get('content-type') || '', /text\/csv/);
  assert.match(exported.response.headers.get('content-disposition') || '', /attachment/);
  assert.match(exported.response.headers.get('content-disposition') || '', /appointments\.csv/);

  const lines = exported.text.trim().split(/\r?\n/);
  assert.equal(lines[0], 'id,name,phone,reason,start_time,end_time,status,created_at');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"Doe, Jane ""JJ"""/);
  assert.match(lines[1], /"Quote ""review"""/);
  assert.match(lines[1], /,booked,/);
});
