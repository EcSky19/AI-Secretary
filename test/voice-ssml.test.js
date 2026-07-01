'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  os.tmpdir(),
  `ai-ssml-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

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
  require('../src/db').db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('incoming greeting renders speech as SSML sentence tags', async () => {
  const { res, text } = await postIncoming('CA-VOICE-SSML');

  assert.equal(res.status, 200);
  assert.match(text, /<Say voice="Polly\.Joanna-Neural">/);
  assert.match(text, /<Say[^>]*>\s*<s>/);
  assert.ok((text.match(/<s>/g) || []).length >= 2);
});
