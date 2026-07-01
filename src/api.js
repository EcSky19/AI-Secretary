'use strict';

const express = require('express');
const db = require('./db');
const notify = require('./notify');
const scheduling = require('./scheduling');
const twilioNumbers = require('./twilio-numbers');
const runtimeConfig = require('./runtime-config');

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
  };
  if (err && Object.prototype.hasOwnProperty.call(statuses, err.code)) {
    throw httpError(statuses[err.code], err.message, { expose: true });
  }
  throw err;
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

function sendSlotTaken(res, startISO, lengthMinutes) {
  const date = startISO.slice(0, 10);
  res.status(409).json({
    error: 'That slot is already taken. Please choose another appointment time.',
    nextAvailableSlots: scheduling.getNextAvailableSlots(date, 5, 14, lengthMinutes),
  });
}

function validateMessageStatus(status) {
  if (!['new', 'read', 'all'].includes(status)) {
    throw httpError(400, "status must be 'new', 'read', or 'all'.");
  }
  return status;
}

router.get('/settings', asyncHandler((req, res) => {
  res.json(db.getSettings());
}));

router.put('/settings', asyncHandler((req, res) => {
  const body = requireBody(req);
  const current = db.getSettings();
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
    db.setSetting('open_days', unique.join(','));
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
    db.setSetting('blackout_dates', unique.join(','));
  }

  for (const [camelKey, dbKey] of Object.entries(SETTING_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
      db.setSetting(dbKey, next[camelKey]);
    }
  }

  res.json(db.getSettings());
}));

router.get('/appointments', asyncHandler((req, res) => {
  const { from, to } = req.query;
  const status = req.query.status || 'booked';
  if (status && !['booked', 'cancelled', 'all'].includes(status)) {
    throw httpError(400, "status must be 'booked', 'cancelled', or 'all'.");
  }
  if (from) validateStamp(from, 'from');
  if (to) validateStamp(to, 'to');
  res.json(db.listAppointments({ status, from, to }));
}));

router.post('/appointments', asyncHandler((req, res) => {
  const body = requireBody(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw httpError(400, 'name is required.');

  const settings = db.getSettings();
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
    const created = db.bookAppointment(rowInput);
    notify.notifyBooked(created, scheduling.formatStampForSpeech).catch(() => {});
    res.status(201).json(created);
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      sendSlotTaken(res, startISO, lengthMinutes);
      return;
    }
    throw err;
  }
}));

router.patch(['/appointments/:id/reschedule', '/appointments/:id'], asyncHandler((req, res) => {
  const id = parseAppointmentId(req.params.id);
  const body = requireBody(req);
  const settings = db.getSettings();
  const lengthMinutes = Object.prototype.hasOwnProperty.call(body, 'lengthMinutes')
    ? parsePositiveInteger(body.lengthMinutes, 'lengthMinutes')
    : settings.appointmentLengthMinutes;
  const startISO = parseAppointmentStart(body);
  const endISO = computeEndStamp(startISO, lengthMinutes);

  try {
    const row = db.rescheduleAppointment(id, startISO, endISO);
    if (!row) throw httpError(404, 'Appointment not found or not booked.');
    notify.notifyRescheduled(row, scheduling.formatStampForSpeech).catch(() => {});
    res.json(row);
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      sendSlotTaken(res, startISO, lengthMinutes);
      return;
    }
    throw err;
  }
}));

router.delete('/appointments/:id', asyncHandler((req, res) => {
  const id = parseAppointmentId(req.params.id);
  const appointment = db.getAppointment(id);
  if (!db.cancelAppointment(id)) throw httpError(404, 'Appointment not found or already cancelled.');
  if (appointment) notify.notifyCancelled(appointment, scheduling.formatStampForSpeech).catch(() => {});
  res.json({ ok: true });
}));

router.get('/availability', asyncHandler((req, res) => {
  const date = req.query.date ? validateDate(req.query.date, 'date') : scheduling.todayDateStr();
  const lengthMinutes = req.query.length
    ? parsePositiveInteger(req.query.length, 'length')
    : db.getSettings().appointmentLengthMinutes;
  res.json(scheduling.getAvailableSlots(date, { lengthMinutes }));
}));

router.get('/messages/unread-count', asyncHandler((req, res) => {
  res.json({ count: db.countNewMessages() });
}));

router.get('/messages', asyncHandler((req, res) => {
  const status = validateMessageStatus(req.query.status || 'all');
  res.json(db.listMessages({ status }));
}));

router.post('/messages', asyncHandler((req, res) => {
  const body = requireBody(req);
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody) throw httpError(400, 'body is required.');
  const row = db.addMessage({
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
  if (!db.setMessageStatus(id, status)) throw httpError(404, 'Message not found.');
  res.json(db.getMessage(id));
}));

router.delete('/messages/:id', asyncHandler((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Message id must be a positive integer.');
  if (!db.deleteMessage(id)) throw httpError(404, 'Message not found.');
  res.json({ ok: true });
}));

router.get('/phone', asyncHandler(async (req, res) => {
  res.json(await twilioNumbers.getStatus());
}));

router.get('/phone/numbers', asyncHandler(async (req, res) => {
  try {
    res.json(await twilioNumbers.listNumbers());
  } catch (err) {
    mapTwilioNumberError(err);
  }
}));

router.post('/phone/register', asyncHandler(async (req, res) => {
  try {
    res.json(await twilioNumbers.registerNumber(requireBody(req)));
  } catch (err) {
    mapTwilioNumberError(err);
  }
}));

router.get('/phone/available', asyncHandler(async (req, res) => {
  try {
    res.json(await twilioNumbers.searchAvailable(req.query));
  } catch (err) {
    mapTwilioNumberError(err);
  }
}));

router.post('/phone/provision', asyncHandler(async (req, res) => {
  try {
    res.status(201).json(await twilioNumbers.purchaseNumber(requireBody(req)));
  } catch (err) {
    mapTwilioNumberError(err);
  }
}));

// --- Runtime configuration (authenticated) --------------------------------

router.get('/config', asyncHandler((req, res) => {
  const creds = runtimeConfig.getTwilioCredentials();
  res.json({
    businessName: runtimeConfig.getBusinessName(),
    adminUser: runtimeConfig.getAdminUser(),
    twilioConfigured: runtimeConfig.isTwilioConfigured(),
    // Never return the auth token; expose only a masked hint.
    twilioAccountSid: creds.accountSid,
    smsFromNumber: creds.phoneNumber,
    hasAuthToken: Boolean(creds.authToken),
    setup: runtimeConfig.getSetupStatus(),
  });
}));

router.put('/config/business', asyncHandler((req, res) => {
  const body = requireBody(req);
  const name = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  if (!name) throw httpError(400, 'businessName is required.');
  runtimeConfig.setBusinessName(name);
  res.json({ ok: true, businessName: runtimeConfig.getBusinessName() });
}));

router.put('/config/twilio', asyncHandler(async (req, res) => {
  const body = requireBody(req);
  const accountSid = body.accountSid !== undefined ? String(body.accountSid).trim() : undefined;
  const authToken = body.authToken !== undefined ? String(body.authToken).trim() : undefined;
  const phoneNumber = body.phoneNumber !== undefined ? String(body.phoneNumber).trim() : undefined;

  if (accountSid !== undefined && accountSid && !accountSid.startsWith('AC')) {
    throw httpError(400, 'accountSid must start with "AC".');
  }

  runtimeConfig.setTwilioCredentials({ accountSid, authToken, phoneNumber });

  // Verify the saved credentials so the UI can show a clear success/failure.
  const result = body.test === false ? { ok: null } : await runtimeConfig.testTwilioCredentials();
  res.json({
    ok: true,
    twilioConfigured: runtimeConfig.isTwilioConfigured(),
    test: result,
  });
}));

router.post('/config/twilio/test', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const creds =
    body.accountSid && body.authToken
      ? { accountSid: String(body.accountSid).trim(), authToken: String(body.authToken).trim() }
      : undefined;
  res.json(await runtimeConfig.testTwilioCredentials(creds));
}));

router.put('/config/admin-password', asyncHandler((req, res) => {
  const body = requireBody(req);
  const password = String(body.password || '');
  if (password.length < 6) throw httpError(400, 'password must be at least 6 characters.');
  const user = body.user !== undefined ? String(body.user).trim() || 'admin' : undefined;
  runtimeConfig.setAdminCredentials({ user, password });
  res.json({ ok: true });
}));

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  const message = status >= 500 && !err.expose ? 'Internal server error.' : err.message;
  if (status >= 500 && !err.expose) console.error(err);
  return res.status(status).json({ error: message });
});

module.exports = router;
