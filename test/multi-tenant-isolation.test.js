'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-mt-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
process.env.ADMIN_USER = 'platform';
process.env.ADMIN_PASSWORD = 'platform-secret';
process.env.ADMIN_TOKEN = '';

const app = require('../server');
const db = require('../src/db');

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
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body, text };
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

function futureDateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function signup(email, businessName) {
  const result = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'correct-horse-1', businessName },
  });
  assert.equal(result.response.status, 201);
  const cookie = cookieFrom(result.response);
  assert.match(cookie, /^sid=/);
  return { ...result, cookie };
}

async function authed(cookie, pathname, options = {}) {
  return request(pathname, {
    ...options,
    headers: { cookie, ...(options.headers || {}) },
  });
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

test('tenant-scoped db helpers isolate appointments, messages, and settings', () => {
  const tenantA = db.createTenant({ slug: 'db-tenant-a', businessName: 'DB Tenant A' });
  const tenantB = db.createTenant({ slug: 'db-tenant-b', businessName: 'DB Tenant B' });

  const apptA = db.bookAppointment({
    tenantId: tenantA.id,
    name: 'Alice A',
    phone: '+15550001001',
    reason: 'Tenant A only',
    startISO: '2099-01-10T09:00',
    endISO: '2099-01-10T09:30',
  });
  const apptB = db.bookAppointment({
    tenantId: tenantB.id,
    name: 'Bob B',
    phone: '+15550002002',
    reason: 'Tenant B only',
    startISO: '2099-01-10T09:00',
    endISO: '2099-01-10T09:30',
  });
  const msgA = db.addMessage({ tenantId: tenantA.id, callerName: 'Caller A', phone: '+15550003003', body: 'A message' });
  const msgB = db.addMessage({ tenantId: tenantB.id, callerName: 'Caller B', phone: '+15550004004', body: 'B message' });
  db.setSetting(tenantA.id, 'isolation_probe', 'tenant-a-value');

  assert.deepEqual(db.listAppointments({ tenantId: tenantA.id }).map((row) => row.id), [apptA.id]);
  assert.deepEqual(db.listAppointments({ tenantId: tenantB.id }).map((row) => row.id), [apptB.id]);
  assert.deepEqual(db.listMessages({ tenantId: tenantA.id }).map((row) => row.id), [msgA.id]);
  assert.deepEqual(db.listMessages({ tenantId: tenantB.id }).map((row) => row.id), [msgB.id]);
  assert.equal(db.getSetting(tenantA.id, 'isolation_probe'), 'tenant-a-value');
  assert.equal(db.getSetting(tenantB.id, 'isolation_probe'), null);
});

test('voice incoming routes by the dialed To number and rejects unknown numbers', async () => {
  const tenantA = db.createTenant({ slug: 'voice-tenant-a', businessName: 'Alpha Dental' });
  const tenantB = db.createTenant({ slug: 'voice-tenant-b', businessName: 'Bravo Clinic' });
  db.assignTenantPhone(tenantA.id, '+15551110001');
  db.assignTenantPhone(tenantB.id, '+15552220002');

  async function incoming(to, callSid) {
    const res = await fetch(`${baseUrl}/voice/incoming`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: callSid, From: '+15553330003', To: to }).toString(),
    });
    return { res, text: await res.text() };
  }

  const routedA = await incoming('+15551110001', 'CA-MT-VOICE-A');
  assert.equal(routedA.res.status, 200);
  assert.match(routedA.text, /Alpha Dental/);
  assert.doesNotMatch(routedA.text, /Bravo Clinic/);

  const routedB = await incoming('+15552220002', 'CA-MT-VOICE-B');
  assert.equal(routedB.res.status, 200);
  assert.match(routedB.text, /Bravo Clinic/);
  assert.doesNotMatch(routedB.text, /Alpha Dental/);

  const unknown = await incoming('+15559999999', 'CA-MT-VOICE-UNKNOWN');
  assert.equal(unknown.res.status, 200);
  assert.match(unknown.text, /not configured yet/i);
});

test('signup login logout flow creates an isolated tenant owner session', async () => {
  const noCookie = await request('/api/config');
  assert.equal(noCookie.response.status, 401);

  const first = await signup('owner@example.com', 'Owner One Co');
  assert.equal(first.body.tenant.business_name, 'Owner One Co');
  const config = await authed(first.cookie, '/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.businessName, 'Owner One Co');

  const duplicate = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'correct-horse-1', businessName: 'Duplicate Co' },
  });
  assert.equal(duplicate.response.status, 409);

  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'wrong-password' },
  });
  assert.equal(wrongPassword.response.status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'correct-horse-1' },
  });
  assert.equal(login.response.status, 200);
  const loginCookie = cookieFrom(login.response);
  assert.equal((await authed(loginCookie, '/api/config')).body.businessName, 'Owner One Co');

  const logout = await authed(loginCookie, '/api/auth/logout', { method: 'POST' });
  assert.equal(logout.response.status, 200);
  const afterLogout = await authed(loginCookie, '/api/config');
  assert.equal(afterLogout.response.status, 401);
});

test('tenant session-scoped API reads cannot leak appointments, messages, or settings', async () => {
  const date = futureDateStr(60);
  const tenantA = await signup('api-a@example.com', 'API Tenant A');
  const tenantB = await signup('api-b@example.com', 'API Tenant B');

  await authed(tenantA.cookie, '/api/settings', {
    method: 'PUT',
    body: { appointmentLengthMinutes: 30, businessHoursStart: '08:00', businessHoursEnd: '12:00' },
  });
  await authed(tenantB.cookie, '/api/settings', {
    method: 'PUT',
    body: { appointmentLengthMinutes: 45, businessHoursStart: '13:00', businessHoursEnd: '17:00' },
  });

  const apptA = await authed(tenantA.cookie, '/api/appointments', {
    method: 'POST',
    body: { name: 'Tenant A Patient', phone: '+15554440001', reason: 'A', date, time: '08:00' },
  });
  assert.equal(apptA.response.status, 201);
  const apptB = await authed(tenantB.cookie, '/api/appointments', {
    method: 'POST',
    body: { name: 'Tenant B Patient', phone: '+15554440002', reason: 'B', date, time: '13:00' },
  });
  assert.equal(apptB.response.status, 201);

  const msgA = await authed(tenantA.cookie, '/api/messages', {
    method: 'POST',
    body: { callerName: 'Message A', phone: '+15554440003', body: 'Tenant A message' },
  });
  assert.equal(msgA.response.status, 201);
  const msgB = await authed(tenantB.cookie, '/api/messages', {
    method: 'POST',
    body: { callerName: 'Message B', phone: '+15554440004', body: 'Tenant B message' },
  });
  assert.equal(msgB.response.status, 201);

  const listA = await authed(tenantA.cookie, `/api/appointments?status=all&from=${date}T00:00&to=${date}T23:59`);
  assert.equal(listA.response.status, 200);
  assert.deepEqual(listA.body.map((row) => row.id), [apptA.body.id]);
  assert.equal(listA.body.some((row) => row.name === 'Tenant B Patient'), false);

  const messagesA = await authed(tenantA.cookie, '/api/messages');
  assert.equal(messagesA.response.status, 200);
  assert.deepEqual(messagesA.body.map((row) => row.id), [msgA.body.id]);
  assert.equal(messagesA.body.some((row) => row.body === 'Tenant B message'), false);

  const settingsA = await authed(tenantA.cookie, '/api/settings');
  assert.equal(settingsA.response.status, 200);
  assert.equal(settingsA.body.businessHoursStart, '08:00');
  assert.equal(settingsA.body.businessHoursEnd, '12:00');
  assert.equal(settingsA.body.appointmentLengthMinutes, 30);
});
