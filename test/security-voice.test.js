'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-security-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.OPENAI_API_KEY = '';

const app = require('../server');
const db = require('../src/db');

let server;
let baseUrl;
let tenantA;
let tenantB;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function postVoice(pathname, params) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { res, text: await res.text() };
}

before(() => {
  tenantA = db.createTenant({ slug: 'security-voice-a', businessName: 'Security Voice A' });
  tenantB = db.createTenant({ slug: 'security-voice-b', businessName: 'Security Voice B' });
  db.assignTenantPhone(tenantA.id, '+15551001001');
  db.assignTenantPhone(tenantB.id, '+15551002002');
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

test('voice respond rejects a fresh call without a resolvable To instead of using the default tenant', async () => {
  const missingTo = await postVoice('/voice/respond', {
    CallSid: 'CA-SEC-RESPOND-MISSING-TO',
    From: '+15559990001',
    SpeechResult: 'book an appointment',
  });
  assert.equal(missingTo.res.status, 200);
  assert.match(missingTo.text, /not configured yet/i);
  assert.match(missingTo.text, /<Hangup/i);

  const unknownTo = await postVoice('/voice/respond', {
    CallSid: 'CA-SEC-RESPOND-UNKNOWN-TO',
    From: '+15559990002',
    To: '+15559999999',
    SpeechResult: 'book an appointment',
  });
  assert.equal(unknownTo.res.status, 200);
  assert.match(unknownTo.text, /not configured yet/i);
  assert.match(unknownTo.text, /<Hangup/i);
  assert.equal(db.listAppointments({ tenantId: db.resolveDefaultTenantId() }).length, 0);
});

test('voice reprompt rejects a fresh call without a resolvable To instead of using the default tenant', async () => {
  const missingTo = await postVoice('/voice/reprompt', {
    CallSid: 'CA-SEC-REPROMPT-MISSING-TO',
    From: '+15559990003',
  });
  assert.equal(missingTo.res.status, 200);
  assert.match(missingTo.text, /not configured yet/i);
  assert.match(missingTo.text, /<Hangup/i);

  const unknownTo = await postVoice('/voice/reprompt', {
    CallSid: 'CA-SEC-REPROMPT-UNKNOWN-TO',
    From: '+15559990004',
    To: '+15559999999',
  });
  assert.equal(unknownTo.res.status, 200);
  assert.match(unknownTo.text, /not configured yet/i);
  assert.match(unknownTo.text, /<Hangup/i);
  assert.equal(db.listAppointments({ tenantId: db.resolveDefaultTenantId() }).length, 0);
});

test('voice respond still works for a fresh call when To matches a tenant', async () => {
  const routed = await postVoice('/voice/respond', {
    CallSid: 'CA-SEC-RESPOND-TENANT-TO',
    From: '+15559990005',
    To: '+15551001001',
    SpeechResult: 'book an appointment',
  });
  assert.equal(routed.res.status, 200);
  assert.doesNotMatch(routed.text, /not configured yet/i);
  assert.match(routed.text, /What day and time/i);
});

test('voice follow-up still works without To when the call state already has a tenantId', async () => {
  const callSid = 'CA-SEC-STATE-TENANT';
  const incoming = await postVoice('/voice/incoming', {
    CallSid: callSid,
    From: '+15559990006',
    To: '+15551002002',
  });
  assert.equal(incoming.res.status, 200);
  assert.doesNotMatch(incoming.text, /not configured yet/i);

  const followup = await postVoice('/voice/respond', {
    CallSid: callSid,
    From: '+15559990006',
    SpeechResult: 'book an appointment',
  });
  assert.equal(followup.res.status, 200);
  assert.doesNotMatch(followup.text, /not configured yet/i);
  assert.match(followup.text, /What day and time/i);
});
