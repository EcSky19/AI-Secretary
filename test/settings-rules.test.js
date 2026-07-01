'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-rules-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;

const app = require('../server');
const db = require('../src/db');
const scheduling = require('../src/scheduling');

let server;
let baseUrl;

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
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
  return { response, body };
}

// Return a future date string that falls on a given JS weekday.
function nextDateForWeekday(targetDow) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

test('settings expose scheduling-rule defaults', async () => {
  const { response, body } = await request('/api/settings');
  assert.equal(response.status, 200);
  assert.deepEqual(body.openDays, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(body.blackoutDates, []);
  assert.equal(body.reminderLeadMinutes, 60);
});

test('PUT settings persists openDays, blackoutDates and reminderLeadMinutes', async () => {
  const blackout = nextDateForWeekday(3); // a Wednesday
  const { response, body } = await request('/api/settings', {
    method: 'PUT',
    body: {
      openDays: [1, 2, 3, 4, 5],
      blackoutDates: [blackout],
      reminderLeadMinutes: 120,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(body.openDays, [1, 2, 3, 4, 5]);
  assert.deepEqual(body.blackoutDates, [blackout]);
  assert.equal(body.reminderLeadMinutes, 120);
});

test('PUT settings rejects invalid weekday and date values', async () => {
  const badDay = await request('/api/settings', { method: 'PUT', body: { openDays: [9] } });
  assert.equal(badDay.response.status, 400);
  const badDate = await request('/api/settings', {
    method: 'PUT',
    body: { blackoutDates: ['2020/01/01'] },
  });
  assert.equal(badDate.response.status, 400);
});

test('closed weekdays yield no available slots', () => {
  db.setSetting('open_days', '1,2,3,4,5'); // Mon-Fri only
  db.setSetting('blackout_dates', '');
  const sunday = nextDateForWeekday(0);
  const monday = nextDateForWeekday(1);
  assert.equal(db.isDateOpen(sunday), false);
  assert.deepEqual(scheduling.getAvailableSlots(sunday), []);
  assert.equal(db.isDateOpen(monday), true);
  assert.ok(scheduling.getAvailableSlots(monday).length > 0);
});

test('blackout dates yield no available slots', () => {
  db.setSetting('open_days', '0,1,2,3,4,5,6');
  const holiday = nextDateForWeekday(2);
  db.setSetting('blackout_dates', holiday);
  assert.equal(db.isDateOpen(holiday), false);
  assert.deepEqual(scheduling.getAvailableSlots(holiday), []);
});
