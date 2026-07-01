'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  os.tmpdir(),
  `secretary-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;

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

function futureDateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  const db = require('../src/db');
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('REST API exposes settings, availability, appointment booking, listing, and cancellation', async () => {
  const date = futureDateStr(40);

  const initialSettings = await request('/api/settings');
  assert.equal(initialSettings.response.status, 200);
  assert.equal(initialSettings.body.appointmentLengthMinutes, 30);
  assert.equal(initialSettings.body.businessHoursStart, '09:00');
  assert.equal(initialSettings.body.businessHoursEnd, '17:00');

  const updatedSettings = await request('/api/settings', {
    method: 'PUT',
    body: {
      appointmentLengthMinutes: 30,
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
    },
  });
  assert.equal(updatedSettings.response.status, 200);
  assert.equal(updatedSettings.body.appointmentLengthMinutes, 30);
  assert.equal(updatedSettings.body.businessHoursStart, '09:00');
  assert.equal(updatedSettings.body.businessHoursEnd, '17:00');

  const availability = await request(`/api/availability?date=${date}`);
  assert.equal(availability.response.status, 200);
  assert.ok(Array.isArray(availability.body));
  assert.equal(availability.body.length, 16);
  assert.equal(availability.body[0].start, '09:00');

  const created = await request('/api/appointments', {
    method: 'POST',
    body: {
      name: 'Test Patient',
      phone: '+15551230000',
      reason: 'Routine checkup',
      date,
      time: '09:00',
    },
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.id);
  assert.equal(created.body.name, 'Test Patient');
  assert.equal(created.body.start_time, `${date}T09:00`);
  assert.equal(created.body.end_time, `${date}T09:30`);
  assert.equal(created.body.status, 'booked');

  const duplicate = await request('/api/appointments', {
    method: 'POST',
    body: {
      name: 'Duplicate Patient',
      phone: '+15551239999',
      reason: 'Overlapping appointment',
      date,
      time: '09:00',
    },
  });
  assert.equal(duplicate.response.status, 409);

  const list = await request(`/api/appointments?status=booked&from=${date}T00:00&to=${date}T23:59`);
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.body));
  assert.ok(list.body.some((appointment) => appointment.id === created.body.id));

  const deleted = await request(`/api/appointments/${created.body.id}`, { method: 'DELETE' });
  assert.ok([200, 204].includes(deleted.response.status));
  if (deleted.response.status === 200) {
    assert.deepEqual(deleted.body, { ok: true });
  }

  const afterDelete = await request(`/api/appointments?status=booked&from=${date}T00:00&to=${date}T23:59`);
  assert.equal(afterDelete.response.status, 200);
  assert.equal(afterDelete.body.some((appointment) => appointment.id === created.body.id), false);
});
