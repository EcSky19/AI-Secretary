'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');

const testDbPath = path.join(
  __dirname,
  `.secretary-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
// Enable signature verification with a known auth token and a fixed base URL.
process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
process.env.TWILIO_VALIDATE_SIGNATURE = 'true';
process.env.PUBLIC_BASE_URL = 'https://example.test';

const app = require('../server');
const db = require('../src/db');

let server;
let port;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

before(() => {
  server = app.listen(0);
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('voice webhook rejects requests without a valid Twilio signature', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/voice/incoming`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ CallSid: 'CA123', From: '+15551112222' }).toString(),
  });
  assert.equal(res.status, 403);
});

test('voice webhook accepts a correctly signed request', async () => {
  const params = { CallSid: 'CA124', From: '+15551112222' };
  // The verifier reconstructs the URL from PUBLIC_BASE_URL + originalUrl.
  const url = 'https://example.test/voice/incoming';
  const signature = twilio.getExpectedTwilioSignature('test-auth-token', url, params);
  const res = await fetch(`http://127.0.0.1:${port}/voice/incoming`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    body: new URLSearchParams(params).toString(),
  });
  // A valid signature passes the verifier; the voice router then handles it
  // (any 2xx/TwiML response means it got past verification).
  assert.notEqual(res.status, 403);
});
