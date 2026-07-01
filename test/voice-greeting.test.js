'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-voice-greeting-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

const app = require('../server');
const db = require('../src/db');
const runtimeConfig = require('../src/runtime-config');

let server;
let baseUrl;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function postIncoming(callSid) {
  const res = await fetch(`${baseUrl}/voice/incoming`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ CallSid: callSid, From: '+15551112222' }).toString(),
  });
  return { res, text: await res.text() };
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

test('voice incoming greeting uses the generic AI Secretary wording by default', async () => {
  const { res, text } = await postIncoming('CA-GENERIC-GREETING');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/xml/);
  assert.match(text, /I am the AI secretary/);
  assert.match(text, /book, cancel, or reschedule/);
});

test('voice incoming greeting includes the configured business name', async () => {
  runtimeConfig.setBusinessName("Bob's Plumbing");
  const { res, text } = await postIncoming('CA-PERSONALIZED-GREETING');
  assert.equal(res.status, 200);
  assert.match(text, /Thank you for calling/);
  assert.match(text, /Bob/);
  assert.match(text, /Plumbing/);
  assert.match(text, /automated assistant/);
});
