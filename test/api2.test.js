'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-api2-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
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

function futureDateStr(daysAhead = 40) {
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

async function createAppointment({ date, time, name = 'API Patient', phone = '+15551230000' }) {
  const created = await request('/api/appointments', {
    method: 'POST',
    body: {
      name,
      phone,
      reason: 'Routine checkup',
      date,
      time,
    },
  });
  assert.equal(created.response.status, 201);
  return created.body;
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

test('REST API reschedules appointments with 200, 404, and 409 paths', async () => {
  const date = futureDateStr(44);
  const first = await createAppointment({ date, time: '09:00', name: 'First Patient' });

  const rescheduled = await request(`/api/appointments/${first.id}/reschedule`, {
    method: 'PATCH',
    body: { date, time: '10:00' },
  });
  assert.equal(rescheduled.response.status, 200);
  assert.equal(rescheduled.body.id, first.id);
  assert.equal(rescheduled.body.start_time, `${date}T10:00`);
  assert.equal(rescheduled.body.end_time, `${date}T10:30`);

  const viaGenericPatch = await request(`/api/appointments/${first.id}`, {
    method: 'PATCH',
    body: { start: `${date}T11:00` },
  });
  assert.equal(viaGenericPatch.response.status, 200);
  assert.equal(viaGenericPatch.body.start_time, `${date}T11:00`);

  const missing = await request('/api/appointments/999999/reschedule', {
    method: 'PATCH',
    body: { date, time: '12:00' },
  });
  assert.equal(missing.response.status, 404);

  const second = await createAppointment({ date, time: '13:00', name: 'Second Patient' });
  const conflict = await request(`/api/appointments/${first.id}`, {
    method: 'PATCH',
    body: { start: second.start_time },
  });
  assert.equal(conflict.response.status, 409);
  assert.match(conflict.body.error, /slot/i);
  assert.ok(Array.isArray(conflict.body.nextAvailableSlots));
});

test('REST API manages phone messages and unread counts', async () => {
  const created = await request('/api/messages', {
    method: 'POST',
    body: {
      callerName: 'Message Caller',
      phone: '+15551239999',
      body: 'Please call me back.',
    },
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.id);
  assert.equal(created.body.caller_name, 'Message Caller');
  assert.equal(created.body.status, 'new');

  const unreadCount = await request('/api/messages/unread-count');
  assert.equal(unreadCount.response.status, 200);
  assert.equal(unreadCount.body.count, 1);

  const newMessages = await request('/api/messages?status=new');
  assert.equal(newMessages.response.status, 200);
  assert.ok(newMessages.body.some((message) => message.id === created.body.id));

  const allMessages = await request('/api/messages?status=all');
  assert.equal(allMessages.response.status, 200);
  assert.ok(allMessages.body.some((message) => message.id === created.body.id));

  const readMessagesBefore = await request('/api/messages?status=read');
  assert.equal(readMessagesBefore.response.status, 200);
  assert.equal(readMessagesBefore.body.some((message) => message.id === created.body.id), false);

  const updated = await request(`/api/messages/${created.body.id}`, {
    method: 'PATCH',
    body: { status: 'read' },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.status, 'read');

  const unreadAfterRead = await request('/api/messages/unread-count');
  assert.equal(unreadAfterRead.body.count, 0);

  const missingPatch = await request('/api/messages/999999', {
    method: 'PATCH',
    body: { status: 'read' },
  });
  assert.equal(missingPatch.response.status, 404);

  const deleted = await request(`/api/messages/${created.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  assert.deepEqual(deleted.body, { ok: true });

  const missingDelete = await request('/api/messages/999999', { method: 'DELETE' });
  assert.equal(missingDelete.response.status, 404);
});
