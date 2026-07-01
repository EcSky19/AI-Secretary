'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-voice-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

test('default assistant voice is a natural Polly Neural voice', () => {
  assert.equal(runtimeConfig.getVoiceName(), 'Polly.Joanna-Neural');
});

test('voice options are a non-empty list of neural voices', () => {
  const options = runtimeConfig.getVoiceOptions();
  assert.ok(Array.isArray(options) && options.length > 0);
  for (const opt of options) {
    assert.equal(typeof opt.name, 'string');
    assert.equal(typeof opt.label, 'string');
    assert.match(opt.name, /-Neural$/);
  }
});

test('incoming greeting TwiML uses the configured neural voice attribute', async () => {
  const { res, text } = await postIncoming('CA-VOICE-DEFAULT');
  assert.equal(res.status, 200);
  assert.match(text, /<Say voice="Polly\.Joanna-Neural">/);
});

test('changing the voice updates the TwiML Say voice attribute', async () => {
  runtimeConfig.setVoiceName('Polly.Matthew-Neural');
  const { text } = await postIncoming('CA-VOICE-CHANGED');
  assert.match(text, /<Say voice="Polly\.Matthew-Neural">/);
  assert.doesNotMatch(text, /Polly\.Joanna-Neural/);
});
