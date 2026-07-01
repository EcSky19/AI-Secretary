'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-notify-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';

const notify = require('../src/notify');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  require('../src/db').db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('SMS notifier safely no-ops without Twilio credentials', async () => {
  assert.equal(notify.isSmsEnabled(), false);

  const result = await notify.sendSms('+15551230000', 'Hello from tests.');
  assert.deepEqual(result, { sent: false, reason: 'not-configured' });
});

test('appointment notification helpers resolve to result objects without credentials', async () => {
  const appointment = {
    phone: '+15551230000',
    start_time: '2099-01-01T09:00',
  };
  const format = (stamp) => `formatted ${stamp}`;

  const booked = await notify.notifyBooked(appointment, format);
  const rescheduled = await notify.notifyRescheduled(appointment, format);
  const cancelled = await notify.notifyCancelled(appointment, format);

  for (const result of [booked, rescheduled, cancelled]) {
    assert.equal(typeof result, 'object');
    assert.equal(result.sent, false);
  }
});
