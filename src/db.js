'use strict';

const crypto = require('crypto');
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
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked',
    created_at TEXT NOT NULL,
    reminder_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL DEFAULT '',
    twilio_phone_number TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id)
  );
`);

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function hasColumn(tableName, columnName) {
  return tableColumns(tableName).some((c) => c.name === columnName);
}

function settingsAreTenantScoped() {
  return hasColumn('settings', 'tenant_id');
}

function getExistingSettingSnapshot() {
  if (!settingsAreTenantScoped()) {
    return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  }
  const rows = db
    .prepare(
      `SELECT s.key, s.value
       FROM settings s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE t.slug = 'default'`
    )
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function normalizeNullablePhone(phone) {
  const trimmed = String(phone || '').trim();
  return trimmed || null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function makeDefaultAdminEmail(user) {
  const trimmed = String(user || '').trim();
  if (looksLikeEmail(trimmed)) return trimmed.toLowerCase();
  if (trimmed) return `${trimmed.replace(/\s+/g, '.').toLowerCase()}@local`;
  return 'owner@default.local';
}

function addColumnIfMissing(tableName, columnSql) {
  const columnName = columnSql.split(/\s+/)[0];
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

function getOrCreateDefaultTenant(snapshot) {
  let tenant = db.prepare(`SELECT * FROM tenants WHERE slug = 'default'`).get();
  if (tenant) return tenant;

  const anyTenant = db.prepare('SELECT * FROM tenants ORDER BY id ASC LIMIT 1').get();
  if (anyTenant) return anyTenant;

  const businessName = String(snapshot.business_name || 'AI Secretary').trim() || 'AI Secretary';
  const phoneNumber = normalizeNullablePhone(snapshot.twilio_phone_number || snapshot.client_phone_number);
  const info = db
    .prepare(
      `INSERT INTO tenants (slug, business_name, twilio_phone_number, status, created_at)
       VALUES ('default', ?, ?, 'active', ?)`
    )
    .run(businessName, phoneNumber, new Date().toISOString());
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(Number(info.lastInsertRowid));
}

function migrateSettingsToTenants(defaultTenantId) {
  if (settingsAreTenantScoped()) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_v2 (
      tenant_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(tenant_id, key),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id)
    )
  `);
  db.prepare(
    `INSERT OR IGNORE INTO settings_v2 (tenant_id, key, value)
     SELECT ?, key, value FROM settings`
  ).run(defaultTenantId);
  db.exec('DROP TABLE settings');
  db.exec('ALTER TABLE settings_v2 RENAME TO settings');
}

function seedDefaultSettings(defaultTenantId) {
  const seedSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (tenant_id, key, value) VALUES (?, ?, ?)'
  );
  seedSetting.run(defaultTenantId, 'business_hours_start', config.defaults.businessHoursStart);
  seedSetting.run(defaultTenantId, 'business_hours_end', config.defaults.businessHoursEnd);
  seedSetting.run(defaultTenantId, 'appointment_length_minutes', String(config.defaults.appointmentLengthMinutes));
  seedSetting.run(defaultTenantId, 'open_days', '0,1,2,3,4,5,6');
  seedSetting.run(defaultTenantId, 'blackout_dates', '');
  seedSetting.run(defaultTenantId, 'reminder_lead_minutes', String(config.reminders.leadMinutes));
  seedSetting.run(defaultTenantId, 'business_name', 'AI Secretary');
}

function ensureDefaultUser(defaultTenantId, snapshot) {
  const passwordHash = snapshot.admin_password_hash;
  if (!passwordHash) return;

  const existing = db.prepare('SELECT id FROM users WHERE tenant_id = ? LIMIT 1').get(defaultTenantId);
  if (existing) return;

  const email = makeDefaultAdminEmail(snapshot.admin_user);
  db.prepare(
    `INSERT OR IGNORE INTO users (tenant_id, email, password_hash, role, created_at)
     VALUES (?, ?, ?, 'owner', ?)`
  ).run(defaultTenantId, email, passwordHash, new Date().toISOString());
}

function runMigrations() {
  try {
    addColumnIfMissing('appointments', 'reminder_sent INTEGER NOT NULL DEFAULT 0');
    const snapshot = getExistingSettingSnapshot();
    const defaultTenant = getOrCreateDefaultTenant(snapshot);
    const defaultTenantId = defaultTenant.id;

    addColumnIfMissing('appointments', 'tenant_id INTEGER');
    addColumnIfMissing('messages', 'tenant_id INTEGER');
    db.prepare('UPDATE appointments SET tenant_id = ? WHERE tenant_id IS NULL').run(defaultTenantId);
    db.prepare('UPDATE messages SET tenant_id = ? WHERE tenant_id IS NULL').run(defaultTenantId);

    migrateSettingsToTenants(defaultTenantId);
    seedDefaultSettings(defaultTenantId);
    ensureDefaultUser(defaultTenantId, snapshot);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start ON appointments(tenant_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_appointments_tenant_status_start ON appointments(tenant_id, status, start_time);
      CREATE INDEX IF NOT EXISTS idx_messages_tenant_status_created ON messages(tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON messages(tenant_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
    `);
  } catch (err) {
    console.error('database migration failed:', err.message);
    throw err;
  }
}

runMigrations();

// ---------------------------------------------------------------------------
// Tenant helpers
// ---------------------------------------------------------------------------

function getDefaultTenant() {
  return db.prepare(`SELECT * FROM tenants WHERE slug = 'default'`).get() ||
    db.prepare('SELECT * FROM tenants ORDER BY id ASC LIMIT 1').get();
}

function resolveDefaultTenantId() {
  const tenant = getDefaultTenant();
  if (!tenant) throw new Error('DEFAULT_TENANT_NOT_FOUND');
  return tenant.id;
}

function resolveTenantId(tenantId) {
  if (tenantId === undefined || tenantId === null || tenantId === '') return resolveDefaultTenantId();
  const n = Number(tenantId);
  if (!Number.isInteger(n) || n <= 0) throw new Error('INVALID_TENANT_ID');
  return n;
}

function createTenant({ slug, businessName = '', twilioPhoneNumber = null } = {}) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) throw new Error('TENANT_SLUG_REQUIRED');
  const info = db
    .prepare(
      `INSERT INTO tenants (slug, business_name, twilio_phone_number, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`
    )
    .run(
      normalizedSlug,
      String(businessName || '').trim(),
      normalizeNullablePhone(twilioPhoneNumber),
      new Date().toISOString()
    );
  return getTenantById(Number(info.lastInsertRowid));
}

function getTenantById(id) {
  if (id === undefined || id === null || id === '') return null;
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(Number(id)) || null;
}

function getTenantBySlug(slug) {
  return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(String(slug || '').trim().toLowerCase()) || null;
}

function getTenantByPhone(e164) {
  const phone = normalizeNullablePhone(e164);
  if (!phone) return null;
  return db.prepare('SELECT * FROM tenants WHERE twilio_phone_number = ?').get(phone) || null;
}

function listTenants() {
  return db.prepare('SELECT * FROM tenants ORDER BY created_at ASC, id ASC').all();
}

function assignTenantPhone(tenantId, e164) {
  const id = resolveTenantId(tenantId);
  db.prepare('UPDATE tenants SET twilio_phone_number = ? WHERE id = ?').run(normalizeNullablePhone(e164), id);
  return getTenantById(id);
}

function setTenantBusinessName(tenantId, businessName) {
  const id = resolveTenantId(tenantId);
  const name = String(businessName || '').trim();
  db.prepare('UPDATE tenants SET business_name = ? WHERE id = ?').run(name, id);
  setSetting(id, 'business_name', name);
  return getTenantById(id);
}

// ---------------------------------------------------------------------------
// User and session helpers
// ---------------------------------------------------------------------------

function createUser({ tenantId, email, passwordHash = '', role = 'owner' } = {}) {
  const id = resolveTenantId(tenantId);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error('USER_EMAIL_REQUIRED');
  const info = db
    .prepare(
      `INSERT INTO users (tenant_id, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, normalizedEmail, String(passwordHash || ''), String(role || 'owner'), new Date().toISOString());
  return getUserById(Number(info.lastInsertRowid));
}

function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) || null;
}

function getUserById(id) {
  if (id === undefined || id === null || id === '') return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)) || null;
}

function createSession(userId, tenantId, ttlMs) {
  const sid = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (Number(ttlMs) || 7 * 24 * 60 * 60 * 1000)).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, tenant_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sid, Number(userId), resolveTenantId(tenantId), createdAt, expiresAt);
  return getSession(sid);
}

function getSession(id) {
  const sid = String(id || '').trim();
  if (!sid) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    deleteSession(sid);
    return null;
  }
  return row;
}

function deleteSession(id) {
  const info = db.prepare('DELETE FROM sessions WHERE id = ?').run(String(id || ''));
  return info.changes > 0;
}

function deleteExpiredSessions() {
  const info = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  return info.changes;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function settingArgs(tenantIdOrKey, key) {
  if (key === undefined) return { tenantId: resolveDefaultTenantId(), key: tenantIdOrKey };
  return { tenantId: resolveTenantId(tenantIdOrKey), key };
}

// Back-compat: omit tenantId to read/write the default tenant's settings.
function getSetting(tenantIdOrKey, key) {
  const args = settingArgs(tenantIdOrKey, key);
  const row = db
    .prepare('SELECT value FROM settings WHERE tenant_id = ? AND key = ?')
    .get(args.tenantId, args.key);
  return row ? row.value : null;
}

function setSetting(tenantIdOrKey, keyOrValue, maybeValue) {
  const args = maybeValue === undefined
    ? { tenantId: resolveDefaultTenantId(), key: tenantIdOrKey, value: keyOrValue }
    : { tenantId: resolveTenantId(tenantIdOrKey), key: keyOrValue, value: maybeValue };
  db.prepare(
    `INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value`
  ).run(args.tenantId, args.key, String(args.value));
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

function getSettings(tenantId) {
  const id = resolveTenantId(tenantId);
  const rows = db.prepare('SELECT key, value FROM settings WHERE tenant_id = ?').all(id);
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

function isDateOpen(dateStr, tenantId) {
  const settings = getSettings(tenantId);
  if (settings.blackoutDates.includes(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  if (!settings.openDays.length) return true;
  return settings.openDays.includes(dow);
}

// ---------------------------------------------------------------------------
// Appointment queries
// ---------------------------------------------------------------------------

function listAppointments({ status = 'booked', from, to, tenantId } = {}) {
  const id = resolveTenantId(tenantId);
  let sql = 'SELECT * FROM appointments WHERE tenant_id = ?';
  const params = [id];
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

function getAppointment(id, tenantId) {
  return db
    .prepare('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?')
    .get(id, resolveTenantId(tenantId));
}

function getOverlapping(startISO, endISO, excludeId = null, tenantId) {
  const id = resolveTenantId(tenantId);
  if (excludeId != null) {
    return db
      .prepare(
        `SELECT * FROM appointments
         WHERE tenant_id = ?
           AND status = 'booked'
           AND id != ?
           AND start_time < ?
           AND end_time > ?
         ORDER BY start_time ASC`
      )
      .all(id, excludeId, endISO, startISO);
  }
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE tenant_id = ?
         AND status = 'booked'
         AND start_time < ?
         AND end_time > ?
       ORDER BY start_time ASC`
    )
    .all(id, endISO, startISO);
}

function isSlotFree(startISO, endISO, excludeId = null, tenantId) {
  return getOverlapping(startISO, endISO, excludeId, tenantId).length === 0;
}

function bookAppointment({ tenantId, name, phone = '', reason = '', startISO, endISO }) {
  const id = resolveTenantId(tenantId);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!isSlotFree(startISO, endISO, null, id)) {
      const err = new Error('SLOT_TAKEN');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    const info = db
      .prepare(
        `INSERT INTO appointments (tenant_id, name, phone, reason, start_time, end_time, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'booked', ?)`
      )
      .run(id, name, phone, reason, startISO, endISO, new Date().toISOString());
    db.exec('COMMIT');
    return getAppointment(Number(info.lastInsertRowid), id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function cancelAppointment(id, tenantId) {
  const info = db
    .prepare(
      `UPDATE appointments SET status = 'cancelled'
       WHERE id = ? AND tenant_id = ? AND status = 'booked'`
    )
    .run(id, resolveTenantId(tenantId));
  return info.changes > 0;
}

function rescheduleAppointment(id, newStartISO, newEndISO, tenantId) {
  const tenant = resolveTenantId(tenantId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare(`SELECT * FROM appointments WHERE id = ? AND tenant_id = ? AND status = 'booked'`)
      .get(id, tenant);
    if (!existing) {
      db.exec('COMMIT');
      return null;
    }
    if (!isSlotFree(newStartISO, newEndISO, id, tenant)) {
      const err = new Error('SLOT_TAKEN');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    db.prepare('UPDATE appointments SET start_time = ?, end_time = ? WHERE id = ? AND tenant_id = ?').run(
      newStartISO,
      newEndISO,
      id,
      tenant
    );
    db.exec('COMMIT');
    return getAppointment(id, tenant);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function findAppointmentsByPhone(phone, { upcomingOnly = true, tenantId } = {}) {
  const id = resolveTenantId(tenantId);
  let sql = `SELECT * FROM appointments WHERE tenant_id = ? AND status = 'booked' AND phone = ?`;
  const params = [id, phone];
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

function addMessage({ tenantId, callerName = '', phone = '', body = '' }) {
  const id = resolveTenantId(tenantId);
  const info = db
    .prepare(
      `INSERT INTO messages (tenant_id, caller_name, phone, body, status, created_at)
       VALUES (?, ?, ?, ?, 'new', ?)`
    )
    .run(id, callerName, phone, body, new Date().toISOString());
  return getMessage(Number(info.lastInsertRowid), id);
}

function getMessage(id, tenantId) {
  return db
    .prepare('SELECT * FROM messages WHERE id = ? AND tenant_id = ?')
    .get(id, resolveTenantId(tenantId));
}

function listMessages({ status = 'all', tenantId } = {}) {
  const id = resolveTenantId(tenantId);
  if (status && status !== 'all') {
    return db
      .prepare('SELECT * FROM messages WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC')
      .all(id, status);
  }
  return db.prepare('SELECT * FROM messages WHERE tenant_id = ? ORDER BY created_at DESC').all(id);
}

function setMessageStatus(id, status, tenantId) {
  const info = db
    .prepare('UPDATE messages SET status = ? WHERE id = ? AND tenant_id = ?')
    .run(status, id, resolveTenantId(tenantId));
  return info.changes > 0;
}

function deleteMessage(id, tenantId) {
  const info = db
    .prepare('DELETE FROM messages WHERE id = ? AND tenant_id = ?')
    .run(id, resolveTenantId(tenantId));
  return info.changes > 0;
}

function countNewMessages(tenantId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND status = 'new'`)
    .get(resolveTenantId(tenantId));
  return row ? row.n : 0;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

function listAppointmentsNeedingReminder(nowStamp, untilStamp, tenantId) {
  const id = resolveTenantId(tenantId);
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE tenant_id = ?
         AND status = 'booked'
         AND reminder_sent = 0
         AND start_time >= ?
         AND start_time <= ?
       ORDER BY start_time ASC`
    )
    .all(id, nowStamp, untilStamp);
}

function markReminderSent(id, tenantId) {
  const info = db
    .prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ? AND tenant_id = ?')
    .run(id, resolveTenantId(tenantId));
  return info.changes > 0;
}

module.exports = {
  db,
  resolveDefaultTenantId,
  resolveTenantId,
  createTenant,
  getTenantById,
  getTenantBySlug,
  getTenantByPhone,
  listTenants,
  assignTenantPhone,
  setTenantBusinessName,
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getSession,
  deleteSession,
  deleteExpiredSessions,
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
