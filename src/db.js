'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// Ensure the data directory exists before opening the database.
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,   -- ISO local wall-clock: YYYY-MM-DDTHH:mm
    end_time TEXT NOT NULL,     -- ISO local wall-clock: YYYY-MM-DDTHH:mm
    status TEXT NOT NULL DEFAULT 'booked',  -- booked | cancelled
    created_at TEXT NOT NULL,
    reminder_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
  CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',  -- new | read
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
`);

// Lightweight migration: add reminder_sent to appointments tables created by
// earlier versions that predate the column.
try {
  const cols = db.prepare('PRAGMA table_info(appointments)').all();
  if (!cols.some((c) => c.name === 'reminder_sent')) {
    db.exec('ALTER TABLE appointments ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0');
  }
} catch (err) {
  console.error('appointments migration failed:', err.message);
}

// Seed default settings on first run (INSERT OR IGNORE keeps user changes).
const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
seedSetting.run('business_hours_start', config.defaults.businessHoursStart);
seedSetting.run('business_hours_end', config.defaults.businessHoursEnd);
seedSetting.run('appointment_length_minutes', String(config.defaults.appointmentLengthMinutes));
// Open days as comma-separated JS day indices (0=Sun..6=Sat); default: all open.
seedSetting.run('open_days', '0,1,2,3,4,5,6');
// Blackout dates as comma-separated YYYY-MM-DD; default: none.
seedSetting.run('blackout_dates', '');
seedSetting.run('reminder_lead_minutes', String(config.reminders.leadMinutes));

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function parseDayList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function parseDateList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    businessHoursStart: out.business_hours_start,
    businessHoursEnd: out.business_hours_end,
    appointmentLengthMinutes: parseInt(out.appointment_length_minutes, 10),
    openDays: parseDayList(out.open_days),
    blackoutDates: parseDateList(out.blackout_dates),
    reminderLeadMinutes: parseInt(out.reminder_lead_minutes, 10) || 60,
  };
}

// True if the given YYYY-MM-DD date is open for booking (open weekday and not
// a blackout date).
function isDateOpen(dateStr) {
  const settings = getSettings();
  if (settings.blackoutDates.includes(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  // Empty openDays means every day is open (avoids accidentally closing shop).
  if (!settings.openDays.length) return true;
  return settings.openDays.includes(dow);
}

// ---------------------------------------------------------------------------
// Appointment queries
// ---------------------------------------------------------------------------

function listAppointments({ status = 'booked', from, to } = {}) {
  let sql = 'SELECT * FROM appointments WHERE 1=1';
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (from) {
    sql += ' AND start_time >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND start_time < ?';
    params.push(to);
  }
  sql += ' ORDER BY start_time ASC';
  return db.prepare(sql).all(...params);
}

function getAppointment(id) {
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}

// Return booked appointments overlapping [start, end), optionally excluding one id.
function getOverlapping(startISO, endISO, excludeId = null) {
  if (excludeId != null) {
    return db
      .prepare(
        `SELECT * FROM appointments
         WHERE status = 'booked'
           AND id != ?
           AND start_time < ?
           AND end_time > ?
         ORDER BY start_time ASC`
      )
      .all(excludeId, endISO, startISO);
  }
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE status = 'booked'
         AND start_time < ?
         AND end_time > ?
       ORDER BY start_time ASC`
    )
    .all(endISO, startISO);
}

function isSlotFree(startISO, endISO, excludeId = null) {
  return getOverlapping(startISO, endISO, excludeId).length === 0;
}

// Book a slot. Throws if the slot overlaps an existing booked appointment.
function bookAppointment({ name, phone = '', reason = '', startISO, endISO }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!isSlotFree(startISO, endISO)) {
      const err = new Error('SLOT_TAKEN');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    const info = db
      .prepare(
        `INSERT INTO appointments (name, phone, reason, start_time, end_time, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'booked', ?)`
      )
      .run(name, phone, reason, startISO, endISO, new Date().toISOString());
    db.exec('COMMIT');
    return getAppointment(Number(info.lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Cancel by id. Returns true if an appointment was cancelled.
function cancelAppointment(id) {
  const info = db
    .prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status = 'booked'`)
    .run(id);
  return info.changes > 0;
}

// Reschedule a booked appointment to a new time. Throws SLOT_TAKEN if the new
// slot overlaps a different booked appointment. Returns the updated row, or
// null if the appointment does not exist / is not currently booked.
function rescheduleAppointment(id, newStartISO, newEndISO) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare(`SELECT * FROM appointments WHERE id = ? AND status = 'booked'`)
      .get(id);
    if (!existing) {
      db.exec('COMMIT');
      return null;
    }
    if (!isSlotFree(newStartISO, newEndISO, id)) {
      const err = new Error('SLOT_TAKEN');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    db.prepare('UPDATE appointments SET start_time = ?, end_time = ? WHERE id = ?').run(
      newStartISO,
      newEndISO,
      id
    );
    db.exec('COMMIT');
    return getAppointment(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Find booked appointments by phone (soonest first), optionally upcoming only.
function findAppointmentsByPhone(phone, { upcomingOnly = true } = {}) {
  let sql = `SELECT * FROM appointments WHERE status = 'booked' AND phone = ?`;
  const params = [phone];
  if (upcomingOnly) {
    sql += ' AND end_time > ?';
    params.push(new Date().toISOString().slice(0, 16));
  }
  sql += ' ORDER BY start_time ASC';
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Messages (phone message-taking / inbox)
// ---------------------------------------------------------------------------

function addMessage({ callerName = '', phone = '', body = '' }) {
  const info = db
    .prepare(
      `INSERT INTO messages (caller_name, phone, body, status, created_at)
       VALUES (?, ?, ?, 'new', ?)`
    )
    .run(callerName, phone, body, new Date().toISOString());
  return getMessage(Number(info.lastInsertRowid));
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function listMessages({ status = 'all' } = {}) {
  if (status && status !== 'all') {
    return db
      .prepare('SELECT * FROM messages WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
}

// Update a message's status ('new' | 'read'). Returns true if a row changed.
function setMessageStatus(id, status) {
  const info = db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
  return info.changes > 0;
}

function deleteMessage(id) {
  const info = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return info.changes > 0;
}

function countNewMessages() {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE status = 'new'`).get();
  return row ? row.n : 0;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

// Booked appointments starting between `nowStamp` and `nowStamp + leadMinutes`
// that have not yet had a reminder sent. Stamps are 'YYYY-MM-DDTHH:mm'.
function listAppointmentsNeedingReminder(nowStamp, untilStamp) {
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE status = 'booked'
         AND reminder_sent = 0
         AND start_time >= ?
         AND start_time <= ?
       ORDER BY start_time ASC`
    )
    .all(nowStamp, untilStamp);
}

function markReminderSent(id) {
  const info = db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  db,
  getSetting,
  setSetting,
  getSettings,
  isDateOpen,
  listAppointments,
  getAppointment,
  getOverlapping,
  isSlotFree,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  findAppointmentsByPhone,
  listAppointmentsNeedingReminder,
  markReminderSent,
  addMessage,
  getMessage,
  listMessages,
  setMessageStatus,
  deleteMessage,
  countNewMessages,
};
