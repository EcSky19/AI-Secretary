'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  os.tmpdir(),
  `ai-ssml-ai-config-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_MODEL = '';

const app = require('../server');

let server;
let baseUrl;
const adminUser = 'boss';
const adminPassword = 'secret1';

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function basicAuth(user = adminUser, password = adminPassword) {
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
  return { response, body, text };
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
      businessName: 'AI Config Test Co',
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      appointmentLengthMinutes: 30,
      adminUser,
      adminPassword,
    },
  });
  assert.equal(setup.response.status, 200);
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  require('../src/db').db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('GET /api/config returns initial AI understanding state without an API key', async () => {
  const { response, body, text } = await authedRequest('/api/config');

  assert.equal(response.status, 200);
  assert.deepEqual(body.aiUnderstanding, {
    enabled: false,
    hasApiKey: false,
    model: 'gpt-4o-mini',
    envManaged: false,
  });
  assert.equal(typeof body.aiUnderstanding.model, 'string');
  assert.doesNotMatch(text, /sk-/);
});

test('PUT /api/config/ai saves a valid key and never returns the raw key', async () => {
  const apiKey = 'sk-test1234567890abcdef';
  const { response, body, text } = await authedRequest('/api/config/ai', {
    method: 'PUT',
    body: { apiKey, model: 'gpt-4o-mini' },
  });

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.aiUnderstanding.hasApiKey, true);
  assert.equal(body.aiUnderstanding.enabled, true);
  assert.equal(body.aiUnderstanding.envManaged, false);
  assert.doesNotMatch(text, new RegExp(apiKey));
});

test('GET /api/config reflects saved AI key without exposing it', async () => {
  const apiKey = 'sk-test1234567890abcdef';
  const { response, body, text } = await authedRequest('/api/config');

  assert.equal(response.status, 200);
  assert.equal(body.aiUnderstanding.hasApiKey, true);
  assert.equal(body.aiUnderstanding.enabled, true);
  assert.equal(body.aiUnderstanding.model, 'gpt-4o-mini');
  assert.doesNotMatch(text, new RegExp(apiKey));
});

test('PUT /api/config/ai rejects an invalid API key', async () => {
  const { response, body } = await authedRequest('/api/config/ai', {
    method: 'PUT',
    body: { apiKey: 'not-a-key' },
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /apiKey/);
});

test('PUT /api/config/ai rejects an invalid model', async () => {
  const { response, body } = await authedRequest('/api/config/ai', {
    method: 'PUT',
    body: { model: 'bad model!' },
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /model/);
});

test('PUT /api/config/ai clears the API key with an empty value', async () => {
  const clear = await authedRequest('/api/config/ai', {
    method: 'PUT',
    body: { apiKey: '' },
  });
  assert.equal(clear.response.status, 200);
  assert.equal(clear.body.aiUnderstanding.hasApiKey, false);
  assert.equal(clear.body.aiUnderstanding.enabled, false);

  const config = await authedRequest('/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.aiUnderstanding.hasApiKey, false);
});
