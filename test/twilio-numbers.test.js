'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-twilio-numbers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';

const db = require('../src/db');
const twilioNumbers = require('../src/twilio-numbers');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function notConfiguredMatcher(err) {
  assert.equal(err.code, 'TWILIO_NOT_CONFIGURED');
  return true;
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('Twilio number helpers degrade gracefully without credentials', async () => {
  assert.equal(twilioNumbers.isConfigured(), false);
  assert.ok(twilioNumbers.getVoiceWebhookUrl().endsWith('/voice/incoming'));
  assert.ok(twilioNumbers.getStatusCallbackUrl().endsWith('/voice/status'));

  const status = await twilioNumbers.getStatus();
  assert.equal(status.configured, false);
  assert.equal(typeof status.webhookUrl, 'string');
  assert.equal(status.registered, false);
  assert.equal(typeof status.activeNumber, 'string');

  await assert.rejects(() => twilioNumbers.listNumbers(), notConfiguredMatcher);
  await assert.rejects(
    () => twilioNumbers.registerNumber({ phoneNumber: '+15551234567' }),
    notConfiguredMatcher
  );
  await assert.rejects(
    () => twilioNumbers.searchAvailable({ areaCode: '415' }),
    notConfiguredMatcher
  );
  await assert.rejects(
    () => twilioNumbers.purchaseNumber({ phoneNumber: '+15551234567' }),
    notConfiguredMatcher
  );
});

test('active Twilio number is persisted in settings', () => {
  twilioNumbers.setActiveNumber('+15559990000', 'PN123');

  assert.equal(twilioNumbers.getActiveNumber(), '+15559990000');
  assert.equal(twilioNumbers.getActiveNumberSid(), 'PN123');
});
