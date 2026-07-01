'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
// Configure admin auth BEFORE requiring the app (config reads env at load).
process.env.ADMIN_USER = 'boss';
process.env.ADMIN_PASSWORD = 's3cret';
process.env.ADMIN_TOKEN = 'tok-123';

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

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('protected API returns 401 without credentials', async () => {
  const res = await fetch(`${baseUrl}/api/settings`);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') || '', /Basic/);
});

test('valid HTTP Basic credentials are accepted', async () => {
  const auth = Buffer.from('boss:s3cret').toString('base64');
  const res = await fetch(`${baseUrl}/api/settings`, {
    headers: { authorization: `Basic ${auth}` },
  });
  assert.equal(res.status, 200);
});

test('wrong password is rejected', async () => {
  const auth = Buffer.from('boss:nope').toString('base64');
  const res = await fetch(`${baseUrl}/api/settings`, {
    headers: { authorization: `Basic ${auth}` },
  });
  assert.equal(res.status, 401);
});

test('bearer token and query token are accepted', async () => {
  const bearer = await fetch(`${baseUrl}/api/settings`, {
    headers: { authorization: 'Bearer tok-123' },
  });
  assert.equal(bearer.status, 200);
  const query = await fetch(`${baseUrl}/api/settings?token=tok-123`);
  assert.equal(query.status, 200);
});

test('health and calendar feed stay open', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const cal = await fetch(`${baseUrl}/calendar.ics`);
  assert.equal(cal.status, 200);
});
