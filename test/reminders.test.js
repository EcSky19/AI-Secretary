'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-reminders-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';

const db = require('../src/db');
const scheduling = require('../src/scheduling');
const reminders = require('../src/reminders');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

function stampInMinutes(minutes) {
  const [datePart, timePart] = scheduling.nowStamp().split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, mi + minutes, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

test('addMinutesToStamp does wall-clock arithmetic', () => {
  assert.equal(reminders.addMinutesToStamp('2025-01-01T09:00', 45), '2025-01-01T09:45');
  assert.equal(reminders.addMinutesToStamp('2025-01-01T23:30', 60), '2025-01-02T00:30');
});

test('listAppointmentsNeedingReminder finds only due, un-notified, booked appts', () => {
  const soon = stampInMinutes(30);
  const soonEnd = stampInMinutes(60);
  const far = stampInMinutes(600);
  const farEnd = stampInMinutes(630);

  const dueId = db.bookAppointment({
    name: 'Due Soon',
    phone: '+15551230000',
    reason: '',
    startISO: soon,
    endISO: soonEnd,
  }).id;
  db.bookAppointment({
    name: 'Far Away',
    phone: '+15551230001',
    reason: '',
    startISO: far,
    endISO: farEnd,
  });

  const now = scheduling.nowStamp();
  const until = reminders.addMinutesToStamp(now, 60);
  const due = db.listAppointmentsNeedingReminder(now, until);
  assert.equal(due.length, 1);
  assert.equal(due[0].id, dueId);

  // Marking as sent removes it from the due list.
  assert.equal(db.markReminderSent(dueId), true);
  assert.equal(db.listAppointmentsNeedingReminder(now, until).length, 0);
});

test('runOnce marks due appointments as reminded', async () => {
  const soon = stampInMinutes(5);
  const soonEnd = stampInMinutes(6);
  const appt = db.bookAppointment({
    name: 'Runonce',
    phone: '+15551230002',
    reason: '',
    startISO: soon,
    endISO: soonEnd,
  });
  await reminders.runOnce();
  const refreshed = db.getAppointment(appt.id);
  assert.equal(refreshed.reminder_sent, 1);
});

