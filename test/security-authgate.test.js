'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-security-authgate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
const originalNodeEnv = process.env.NODE_ENV;
const originalAuthRequired = process.env.AUTH_REQUIRED;

process.env.DATABASE_PATH = testDbPath;
delete process.env.ADMIN_USER;
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_TOKEN;
delete process.env.AUTH_REQUIRED;
delete process.env.NODE_ENV;

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
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

function restoreNodeEnv() {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalAuthRequired === undefined) {
    delete process.env.AUTH_REQUIRED;
  } else {
    process.env.AUTH_REQUIRED = originalAuthRequired;
  }
}

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  restoreNodeEnv();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('production requires auth even before signup', async () => {
  process.env.NODE_ENV = 'production';
  const { response, body } = await request('/api/config');
  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: 'Authentication required' });
  delete process.env.NODE_ENV;
});

test('legacy dev install without configured auth or signups stays open', async () => {
  delete process.env.NODE_ENV;
  const { response, body } = await request('/api/config');
  assert.equal(response.status, 200);
  assert.equal(body.businessName, 'AI Secretary');
});

test('signup closes the unauthenticated API gate', async () => {
  delete process.env.NODE_ENV;
  const signup = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      email: 'security-owner@example.com',
      password: 'correct-horse-1',
      businessName: 'Security Owner Co',
    },
  });
  assert.equal(signup.response.status, 201);

  const { response, body } = await request('/api/config');
  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: 'Authentication required' });
});
