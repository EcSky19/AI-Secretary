'use strict';

const express = require('express');
const db = require('./db');
const notify = require('./notify');
const email = require('./email');
const scheduling = require('./scheduling');
const twilioNumbers = require('./twilio-numbers');
const runtimeConfig = require('./runtime-config');
const backups = require('./backups');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)$/;
const SETTING_KEYS = {
  businessHoursStart: 'business_hours_start',
  businessHoursEnd: 'business_hours_end',
  appointmentLengthMinutes: 'appointment_length_minutes',
  reminderLeadMinutes: 'reminder_lead_minutes',
};

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireBody(req) {
  if (!isPlainObject(req.body)) throw httpError(400, 'Request body must be a JSON object.');
  return req.body;
}

function mapTwilioNumberError(err) {
  const statuses = {
    TWILIO_NOT_CONFIGURED: 503,
    INVALID_INPUT: 400,
    NUMBER_NOT_FOUND: 404,
    NUMBER_ALREADY_ASSIGNED: 409,
    TENANT_NOT_FOUND: 404,
    NO_AVAILABLE_NUMBERS: 404,
  };
  if (err && Object.prototype.hasOwnProperty.call(statuses, err.code)) {
    throw httpError(statuses[err.code], err.message, { expose: true });
  }
  throw err;
}

function twilioResultStatus(result) {
  const code = result && result.error && result.error.code;
  const statuses = {
    TWILIO_NOT_CONFIGURED: 503,
    INVALID_INPUT: 400,
    NUMBER_NOT_FOUND: 404,
    NUMBER_ALREADY_ASSIGNED: 409,
    TENANT_NOT_FOUND: 404,
    NO_AVAILABLE_NUMBERS: 404,
  };
  return statuses[code] || 400;
}

function sendTwilioResult(res, result, successStatus = 200) {
  if (result && result.ok === false) {
    return res.status(twilioResultStatus(result)).json(result);
  }
  return res.status(successStatus).json(result);
}

function validateDate(dateStr, field = 'date') {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) {
    throw httpError(400, `${field} must be in YYYY-MM-DD format.`);
  }
  return dateStr;
}

function validateTime(time, field = 'time') {
  if (typeof time !== 'string' || !TIME_RE.test(time)) {
    throw httpError(400, `${field} must be in HH:mm format.`);
  }
  return time;
}

function validateStamp(stamp, field = 'start') {
  if (typeof stamp !== 'string' || !STAMP_RE.test(stamp)) {
    throw httpError(400, `${field} must be in YYYY-MM-DDTHH:mm format.`);
  }
  return stamp;
}

function parsePositiveInteger(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw httpError(400, `${field} must be a positive integer.`);
  }
  return number;
}

function timeLessThan(left, right) {
  return scheduling.timeToMinutes(left) < scheduling.timeToMinutes(right);
}

function computeEndStamp(startStamp, lengthMinutes) {
  const [dateStr, startTime] = startStamp.split('T');
  const endMinutes = scheduling.timeToMinutes(startTime) + lengthMinutes;
  if (endMinutes > 24 * 60) {
    throw httpError(400, 'Appointment end time must be on the same day.');
  }
  const endTime = endMinutes === 24 * 60 ? '24:00' : scheduling.minutesToTime(endMinutes);
  return `${dateStr}T${endTime}`;
}

function parseAppointmentId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Appointment id must be a positive integer.');
  return id;
}

function parseAppointmentStart(body) {
  if (body.start) return validateStamp(body.start, 'start');
  const date = validateDate(body.date, 'date');
  const time = validateTime(body.time, 'time');
  return scheduling.makeStamp(date, time);
}

function tenantId(req) {
  return req.tenantId || db.resolveDefaultTenantId();
}

function getAvailableSlotsForTenant(dateStr, opts = {}, id) {
  if (!db.isDateOpen(dateStr, id)) return [];

  const settings = db.getSettings(id);
  const length = opts.lengthMinutes || settings.appointmentLengthMinutes;
  const startMin = scheduling.timeToMinutes(settings.businessHoursStart);
  const endMin = scheduling.timeToMinutes(settings.businessHoursEnd);
  const now = scheduling.nowStamp();

  const slots = [];
  for (let t = startMin; t + length <= endMin; t += length) {
    const startTime = scheduling.minutesToTime(t);
    const endTime = scheduling.minutesToTime(t + length);
    const startStamp = scheduling.makeStamp(dateStr, startTime);
    const endStamp = scheduling.makeStamp(dateStr, endTime);

    if (startStamp < now) continue;
    if (!db.isSlotFree(startStamp, endStamp, null, id)) continue;

    slots.push({
      date: dateStr,
      start: startTime,
      end: endTime,
      startStamp,
      endStamp,
      label: scheduling.formatTimeForSpeech(startTime),
    });
  }
  return slots;
}

function getNextAvailableSlotsForTenant(fromDateStr, count, daysAhead, lengthMinutes, id) {
  const results = [];
  const [y, mo, d] = fromDateStr.split('-').map(Number);
  const cursor = new Date(y, mo - 1, d);
  const pad = (n) => String(n).padStart(2, '0');

  for (let i = 0; i < daysAhead && results.length < count; i += 1) {
    const dateStr = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
    const daySlots = getAvailableSlotsForTenant(dateStr, { lengthMinutes }, id);
    for (const slot of daySlots) {
      results.push(slot);
      if (results.length >= count) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

function getCalendarToken(id) {
  let token = db.getSetting(id, 'calendar_token');
  if (!token) {
    token = crypto.randomBytes(32).toString('base64url');
    db.setSetting(id, 'calendar_token', token);
  }
  return token;
}

function buildCalendarUrl(req, token) {
  const base = (config.publicBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/calendar.ics?t=${encodeURIComponent(token)}`;
}


function sendSlotTaken(res, startISO, lengthMinutes, id) {
  const date = startISO.slice(0, 10);
  res.status(409).json({
    error: 'That slot is already taken. Please choose another appointment time.',
    nextAvailableSlots: getNextAvailableSlotsForTenant(date, 5, 14, lengthMinutes, id),
  });
}

function validateMessageStatus(status) {
  if (!['new', 'read', 'all'].includes(status)) {
    throw httpError(400, "status must be 'new', 'read', or 'all'.");
  }
  return status;
}

router.get('/settings', asyncHandler((req, res) => {
  res.json(db.getSettings(tenantId(req)));
}));

router.put('/settings', asyncHandler((req, res) => {
  const body = requireBody(req);
  const id = tenantId(req);
  const current = db.getSettings(id);
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(body, 'appointmentLengthMinutes')) {
    next.appointmentLengthMinutes = parsePositiveInteger(
      body.appointmentLengthMinutes,
      'appointmentLengthMinutes'
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, 'businessHoursStart')) {
    next.businessHoursStart = validateTime(body.businessHoursStart, 'businessHoursStart');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'businessHoursEnd')) {
    next.businessHoursEnd = validateTime(body.businessHoursEnd, 'businessHoursEnd');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'reminderLeadMinutes')) {
    next.reminderLeadMinutes = parsePositiveInteger(
      body.reminderLeadMinutes,
      'reminderLeadMinutes'
    );
  }

  if (!timeLessThan(next.businessHoursStart, next.businessHoursEnd)) {
    throw httpError(400, 'businessHoursStart must be earlier than businessHoursEnd.');
  }

  // Open days: array (or comma-separated string) of JS day indices 0-6.
  if (Object.prototype.hasOwnProperty.call(body, 'openDays')) {
    const raw = Array.isArray(body.openDays)
      ? body.openDays
      : String(body.openDays).split(',');
    const days = raw
      .map((d) => String(d).trim())
      .filter((s) => s !== '')
      .map(Number);
    for (const d of days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        throw httpError(400, 'openDays must be integers between 0 (Sunday) and 6 (Saturday).');
      }
    }
    const unique = [...new Set(days)].sort((a, b) => a - b);
    db.setSetting(id, 'open_days', unique.join(','));
  }

  // Blackout dates: array (or comma-separated string) of YYYY-MM-DD.
  if (Object.prototype.hasOwnProperty.call(body, 'blackoutDates')) {
    const raw = Array.isArray(body.blackoutDates)
      ? body.blackoutDates
      : String(body.blackoutDates).split(',');
    const dates = raw.map((d) => String(d).trim()).filter((s) => s !== '');
    for (const d of dates) {
      if (!DATE_RE.test(d)) {
        throw httpError(400, `blackoutDates must be YYYY-MM-DD dates (got "${d}").`);
      }
    }
    const unique = [...new Set(dates)].sort();
    db.setSetting(id, 'blackout_dates', unique.join(','));
  }

  for (const [camelKey, dbKey] of Object.entries(SETTING_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
      db.setSetting(id, dbKey, next[camelKey]);
    }
  }

  res.json(db.getSettings(tenantId(req)));
}));

router.get('/appointments', asyncHandler((req, res) => {
  const { from, to } = req.query;
  const status = req.query.status || 'booked';
  if (status && !['booked', 'cancelled', 'all'].includes(status)) {
    throw httpError(400, "status must be 'booked', 'cancelled', or 'all'.");
  }
  if (from) validateStamp(from, 'from');
  if (to) validateStamp(to, 'to');
  res.json(db.listAppointments({ status, from, to, tenantId: tenantId(req) }));
}));

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export appointments as a CSV file so owners can keep their own records.
router.get('/appointments/export.csv', asyncHandler((req, res) => {
  const { from, to } = req.query;
  const status = req.query.status || 'all';
  if (status && !['booked', 'cancelled', 'all'].includes(status)) {
    throw httpError(400, "status must be 'booked', 'cancelled', or 'all'.");
  }
  if (from) validateStamp(from, 'from');
  if (to) validateStamp(to, 'to');

  const rows = db.listAppointments({ status, from, to, tenantId: tenantId(req) });
  const header = ['id', 'name', 'phone', 'reason', 'start_time', 'end_time', 'status', 'created_at'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => csvCell(r[h])).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="appointments.csv"');
  res.send(lines.join('\r\n') + '\r\n');
}));

router.post('/appointments', asyncHandler((req, res) => {
  const body = requireBody(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw httpError(400, 'name is required.');

  const settings = db.getSettings(tenantId(req));
  const lengthMinutes = Object.prototype.hasOwnProperty.call(body, 'lengthMinutes')
    ? parsePositiveInteger(body.lengthMinutes, 'lengthMinutes')
    : settings.appointmentLengthMinutes;

  const startISO = parseAppointmentStart(body);

  const endISO = computeEndStamp(startISO, lengthMinutes);
  const rowInput = {
    name,
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    startISO,
    endISO,
  };

  try {
    const created = db.bookAppointment({ ...rowInput, tenantId: tenantId(req) });
    notify.notifyBooked(created, scheduling.formatStampForSpeech).catch(() => {});
    res.status(201).json(created);
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      sendSlotTaken(res, startISO, lengthMinutes, tenantId(req));
      return;
    }
    throw err;
  }
}));

router.patch(['/appointments/:id/reschedule', '/appointments/:id'], asyncHandler((req, res) => {
  const id = parseAppointmentId(req.params.id);
  const body = requireBody(req);
  const settings = db.getSettings(tenantId(req));
  const lengthMinutes = Object.prototype.hasOwnProperty.call(body, 'lengthMinutes')
    ? parsePositiveInteger(body.lengthMinutes, 'lengthMinutes')
    : settings.appointmentLengthMinutes;
  const startISO = parseAppointmentStart(body);
  const endISO = computeEndStamp(startISO, lengthMinutes);

  try {
    const row = db.rescheduleAppointment(id, startISO, endISO, tenantId(req));
    if (!row) throw httpError(404, 'Appointment not found or not booked.');
    notify.notifyRescheduled(row, scheduling.formatStampForSpeech).catch(() => {});
    res.json(row);
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      sendSlotTaken(res, startISO, lengthMinutes, tenantId(req));
      return;
    }
    throw err;
  }
}));

router.delete('/appointments/:id', asyncHandler((req, res) => {
  const id = parseAppointmentId(req.params.id);
  const appointment = db.getAppointment(id, tenantId(req));
  if (!db.cancelAppointment(id, tenantId(req))) throw httpError(404, 'Appointment not found or already cancelled.');
  if (appointment) notify.notifyCancelled(appointment, scheduling.formatStampForSpeech).catch(() => {});
  res.json({ ok: true });
}));

router.get('/availability', asyncHandler((req, res) => {
  const date = req.query.date ? validateDate(req.query.date, 'date') : scheduling.todayDateStr();
  const lengthMinutes = req.query.length
    ? parsePositiveInteger(req.query.length, 'length')
    : db.getSettings(tenantId(req)).appointmentLengthMinutes;
  res.json(getAvailableSlotsForTenant(date, { lengthMinutes }, tenantId(req)));
}));

router.get('/messages/unread-count', asyncHandler((req, res) => {
  res.json({ count: db.countNewMessages(tenantId(req)) });
}));

router.get('/messages', asyncHandler((req, res) => {
  const status = validateMessageStatus(req.query.status || 'all');
  res.json(db.listMessages({ status, tenantId: tenantId(req) }));
}));

router.post('/messages', asyncHandler((req, res) => {
  const body = requireBody(req);
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody) throw httpError(400, 'body is required.');
  const row = db.addMessage({
    tenantId: tenantId(req),
    callerName: typeof body.callerName === 'string' ? body.callerName.trim() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    body: messageBody,
  });
  res.status(201).json(row);
}));

router.patch('/messages/:id', asyncHandler((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Message id must be a positive integer.');
  const body = requireBody(req);
  const status = typeof body.status === 'string' ? body.status : '';
  if (!['new', 'read'].includes(status)) throw httpError(400, "status must be 'new' or 'read'.");
  if (!db.setMessageStatus(id, status, tenantId(req))) throw httpError(404, 'Message not found.');
  res.json(db.getMessage(id, tenantId(req)));
}));

router.delete('/messages/:id', asyncHandler((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Message id must be a positive integer.');
  if (!db.deleteMessage(id, tenantId(req))) throw httpError(404, 'Message not found.');
  res.json({ ok: true });
}));

router.get('/phone', asyncHandler(async (req, res) => {
  res.json(await twilioNumbers.getStatus(tenantId(req)));
}));

router.get('/phone/numbers', asyncHandler(async (req, res) => {
  try {
    res.json(await twilioNumbers.listNumbers(tenantId(req)));
  } catch (err) {
    mapTwilioNumberError(err);
  }
}));

router.post('/phone/register', asyncHandler(async (req, res) => {
  const body = requireBody(req);
  const result = await twilioNumbers.assignExistingNumberToTenant(tenantId(req), body.phoneNumber);
  sendTwilioResult(res, result);
}));

router.get('/phone/available', asyncHandler(async (req, res) => {
  const result = await twilioNumbers.listAvailableNumbers({ ...req.query, tenantId: tenantId(req) });
  sendTwilioResult(res, result);
}));

router.post('/phone/provision', asyncHandler(async (req, res) => {
  const body = requireBody(req);
  const result = await twilioNumbers.provisionNumberForTenant(tenantId(req), {
    areaCode: body.areaCode,
    contains: body.contains,
  });
  sendTwilioResult(res, result, 201);
}));


router.get('/calendar', asyncHandler((req, res) => {
  const id = tenantId(req);
  const token = getCalendarToken(id);
  res.json({
    token,
    url: buildCalendarUrl(req, token),
    path: `/calendar.ics?t=${encodeURIComponent(token)}`,
  });
}));

// --- Runtime configuration (authenticated) --------------------------------

router.get('/config', asyncHandler((req, res) => {
  const id = tenantId(req);
  const creds = runtimeConfig.getTwilioCredentials(id);
  res.json({
    businessName: runtimeConfig.getBusinessName(id),
    adminUser: runtimeConfig.getAdminUser(id),
    twilioConfigured: runtimeConfig.isTwilioConfigured(id),
    // Never return the auth token; expose only a masked hint.
    twilioAccountSid: creds.accountSid,
    smsFromNumber: creds.phoneNumber,
    hasAuthToken: Boolean(creds.authToken),
    recoveryPhone: runtimeConfig.getRecoveryPhone(id),
    recoveryEmail: runtimeConfig.getRecoveryEmail(id),
    emailConfigured: runtimeConfig.isEmailConfigured(id),
    voiceName: runtimeConfig.getVoiceName(id),
    voiceOptions: runtimeConfig.getVoiceOptions(),
    voiceEnvManaged: runtimeConfig.isVoiceEnvManaged(),
    aiUnderstanding: (() => {
      const ai = runtimeConfig.getOpenAiConfig(tenantId(req));
      // Never return the API key; expose only whether one is configured.
      return {
        enabled: runtimeConfig.isAiUnderstandingEnabled(id),
        hasApiKey: Boolean(ai.apiKey),
        model: ai.model,
        envManaged: runtimeConfig.isOpenAiEnvManaged(),
      };
    })(),
    email: (() => {
      const e = runtimeConfig.getEmailConfig(id);
      // Never return the SMTP password; expose only whether one is set.
      return { host: e.host, port: e.port, secure: e.secure, user: e.user, from: e.from, hasPassword: Boolean(e.pass) };
    })(),
    setup: runtimeConfig.getSetupStatus(id),
  });
}));

router.put('/config/business', asyncHandler((req, res) => {
  const body = requireBody(req);
  const name = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  if (!name) throw httpError(400, 'businessName is required.');
  runtimeConfig.setBusinessName(name, tenantId(req));
  res.json({ ok: true, businessName: runtimeConfig.getBusinessName(tenantId(req)) });
}));

router.put('/config/twilio', asyncHandler(async (req, res) => {
  const body = requireBody(req);
  const accountSid = body.accountSid !== undefined ? String(body.accountSid).trim() : undefined;
  const authToken = body.authToken !== undefined ? String(body.authToken).trim() : undefined;
  const phoneNumber = body.phoneNumber !== undefined ? String(body.phoneNumber).trim() : undefined;

  if (accountSid !== undefined && accountSid && !accountSid.startsWith('AC')) {
    throw httpError(400, 'accountSid must start with "AC".');
  }

  runtimeConfig.setTwilioCredentials({ accountSid, authToken, phoneNumber }, tenantId(req));

  // Verify the saved credentials so the UI can show a clear success/failure.
  const result = body.test === false ? { ok: null } : await runtimeConfig.testTwilioCredentials(runtimeConfig.getTwilioCredentials(tenantId(req)));
  res.json({
    ok: true,
    twilioConfigured: runtimeConfig.isTwilioConfigured(tenantId(req)),
    test: result,
  });
}));

router.post('/config/twilio/test', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const creds =
    body.accountSid && body.authToken
      ? { accountSid: String(body.accountSid).trim(), authToken: String(body.authToken).trim() }
      : undefined;
  res.json(await runtimeConfig.testTwilioCredentials(creds || runtimeConfig.getTwilioCredentials(tenantId(req))));
}));

router.put('/config/admin-password', asyncHandler((req, res) => {
  const body = requireBody(req);
  const password = String(body.password || '');
  if (password.length < 6) throw httpError(400, 'password must be at least 6 characters.');
  const user = body.user !== undefined ? String(body.user).trim() || 'admin' : undefined;
  runtimeConfig.setAdminCredentials({ user, password }, tenantId(req));
  res.json({ ok: true });
}));

router.put('/config/recovery-phone', asyncHandler((req, res) => {
  const body = requireBody(req);
  const phone = body.recoveryPhone === undefined ? '' : String(body.recoveryPhone || '').trim();
  if (phone && !/^\+?[0-9][0-9\s().-]{5,}$/.test(phone)) {
    throw httpError(400, 'recoveryPhone must be a valid phone number.');
  }
  runtimeConfig.setRecoveryPhone(phone, tenantId(req));
  res.json({ ok: true, recoveryPhone: runtimeConfig.getRecoveryPhone(tenantId(req)) });
}));

router.put('/config/voice', asyncHandler((req, res) => {
  const body = requireBody(req);
  const name = String(body.voiceName || '').trim();
  if (!name) throw httpError(400, 'voiceName is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-]{1,60}$/.test(name)) {
    throw httpError(400, 'voiceName has an invalid format.');
  }
  runtimeConfig.setVoiceName(name, tenantId(req));
  res.json({ ok: true, voiceName: runtimeConfig.getVoiceName(tenantId(req)) });
}));

router.put('/config/ai', asyncHandler((req, res) => {
  const body = requireBody(req);
  if (runtimeConfig.isOpenAiEnvManaged()) {
    throw httpError(409, 'AI understanding is configured via the OPENAI_API_KEY environment variable and cannot be changed here.');
  }
  const update = {};
  if (body.apiKey !== undefined) {
    const key = String(body.apiKey || '').trim();
    if (key && !/^sk-[A-Za-z0-9_-]{10,}$/.test(key)) {
      throw httpError(400, 'apiKey does not look like a valid OpenAI key.');
    }
    update.apiKey = key;
  }
  if (body.model !== undefined) {
    const model = String(body.model || '').trim();
    if (model && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,60}$/.test(model)) {
      throw httpError(400, 'model has an invalid format.');
    }
    update.model = model;
  }
  runtimeConfig.setOpenAiConfig(update, tenantId(req));
  const id = tenantId(req);
  const ai = runtimeConfig.getOpenAiConfig(id);
  res.json({
    ok: true,
    aiUnderstanding: {
      enabled: runtimeConfig.isAiUnderstandingEnabled(id),
      hasApiKey: Boolean(ai.apiKey),
      model: ai.model,
      envManaged: runtimeConfig.isOpenAiEnvManaged(),
    },
  });
}));

router.put('/config/recovery-email', asyncHandler((req, res) => {
  const body = requireBody(req);
  const addr = body.recoveryEmail === undefined ? '' : String(body.recoveryEmail || '').trim();
  if (addr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    throw httpError(400, 'recoveryEmail must be a valid email address.');
  }
  runtimeConfig.setRecoveryEmail(addr, tenantId(req));
  res.json({ ok: true, recoveryEmail: runtimeConfig.getRecoveryEmail(tenantId(req)) });
}));

router.put('/config/email', asyncHandler(async (req, res) => {
  const body = requireBody(req);
  const host = body.host !== undefined ? String(body.host).trim() : undefined;
  const port = body.port !== undefined ? Number(body.port) : undefined;
  const secure = body.secure !== undefined ? Boolean(body.secure) : undefined;
  const user = body.user !== undefined ? String(body.user).trim() : undefined;
  const pass = body.pass !== undefined ? String(body.pass) : undefined;
  const from = body.from !== undefined ? String(body.from).trim() : undefined;

  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw httpError(400, 'port must be a valid port number.');
  }
  if (from !== undefined && from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw httpError(400, 'from must be a valid email address.');
  }

  runtimeConfig.setEmailConfig({ host, port, secure, user, pass, from }, tenantId(req));

  const result = body.test === false ? { ok: null } : await email.testEmailConfig(runtimeConfig.getEmailConfig(tenantId(req)));
  res.json({ ok: true, emailConfigured: runtimeConfig.isEmailConfigured(tenantId(req)), test: result });
}));

router.post('/config/email/test', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const overrides =
    body.host
      ? {
          host: String(body.host).trim(),
          port: Number(body.port) || 587,
          secure: Boolean(body.secure),
          user: body.user ? String(body.user).trim() : '',
          pass: body.pass ? String(body.pass) : '',
          from: body.from ? String(body.from).trim() : '',
        }
      : undefined;
  res.json(await email.testEmailConfig(overrides || runtimeConfig.getEmailConfig(tenantId(req))));
}));

// --- Backups (authenticated) ----------------------------------------------

router.get('/backups', asyncHandler((req, res) => {
  const list = backups.listBackups().map(({ name, size, createdAt }) => ({ name, size, createdAt }));
  res.json({ dir: backups.getBackupsDir(), backups: list });
}));

router.post('/backups', asyncHandler((req, res) => {
  const result = backups.createBackup();
  res.status(201).json({
    ok: true,
    name: require('path').basename(result.file),
    size: result.size,
    createdAt: result.createdAt,
  });
}));

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  const message = status >= 500 && !err.expose ? 'Internal server error.' : err.message;
  if (status >= 500 && !err.expose) console.error(err);
  return res.status(status).json({ error: message });
});

module.exports = router;
