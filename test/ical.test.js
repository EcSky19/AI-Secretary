'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-ical-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;

const app = require('../server');
const db = require('../src/db');
const { buildCalendar } = require('../src/ical');

let server;
let baseUrl;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('buildCalendar produces valid VCALENDAR with events', () => {
  const cal = buildCalendar([
    {
      id: 1,
      name: 'Jane Doe',
      phone: '+15551234567',
      reason: 'Consult; follow-up',
      start_time: '2025-06-01T09:00',
      end_time: '2025-06-01T09:30',
      status: 'booked',
    },
  ]);
  assert.match(cal, /^BEGIN:VCALENDAR/);
  assert.match(cal, /END:VCALENDAR\r\n$/);
  assert.match(cal, /BEGIN:VEVENT/);
  assert.match(cal, /UID:appointment-1@/);
  assert.match(cal, /DTSTART:20250601T090000/);
  assert.match(cal, /DTEND:20250601T093000/);
  assert.match(cal, /SUMMARY:Jane Doe - Consult\\; follow-up/);
  assert.match(cal, /STATUS:CONFIRMED/);
  // Lines are CRLF-separated per RFC 5545.
  assert.ok(cal.includes('\r\n'));
});

test('buildCalendar handles empty list', () => {
  const cal = buildCalendar([]);
  assert.match(cal, /BEGIN:VCALENDAR/);
  assert.match(cal, /END:VCALENDAR/);
  assert.doesNotMatch(cal, /BEGIN:VEVENT/);
});

test('/calendar.ics serves booked appointments as text/calendar', async () => {
  db.bookAppointment({
    name: 'Cal Feed',
    phone: '+15550000000',
    reason: 'Checkup',
    startISO: '2030-01-02T10:00',
    endISO: '2030-01-02T10:30',
  });
  const res = await fetch(`${baseUrl}/calendar.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/calendar/);
  const text = await res.text();
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /SUMMARY:Cal Feed/);
});
