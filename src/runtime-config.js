'use strict';

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

// ---------------------------------------------------------------------------
// Runtime configuration
//
// Non-technical operators can't edit .env files, so sensitive/operational
// settings (Twilio credentials, business profile, admin password) are stored in
// the database and editable from the browser. Environment variables still take
// precedence when present, so technical/hosted deployments can pin config via
// env and skip the onboarding wizard entirely.
// ---------------------------------------------------------------------------

// Modules that cache a Twilio client register a reset callback so cached
// clients are rebuilt when credentials change at runtime.
const changeListeners = [];
function onCredentialsChange(cb) {
  if (typeof cb === 'function') changeListeners.push(cb);
}
function notifyChange() {
  for (const cb of changeListeners) {
    try {
      cb();
    } catch (err) {
      console.error('runtime-config change listener failed:', err.message);
    }
  }
}

// --- Business profile ------------------------------------------------------

function getBusinessName() {
  return db.getSetting('business_name') || 'AI Secretary';
}
function setBusinessName(name) {
  db.setSetting('business_name', String(name || '').trim());
}

// --- Recovery phone (for password reset by SMS) ----------------------------

function getRecoveryPhone() {
  return db.getSetting('recovery_phone') || '';
}
function setRecoveryPhone(phone) {
  db.setSetting('recovery_phone', String(phone || '').trim());
}

// --- Recovery email (for password reset by email) --------------------------

function getRecoveryEmail() {
  return db.getSetting('recovery_email') || '';
}
function setRecoveryEmail(email) {
  db.setSetting('recovery_email', String(email || '').trim());
}

// --- Email / SMTP settings -------------------------------------------------

function getEmailConfig() {
  const env = config.email;
  const port = env.port || parseInt(db.getSetting('smtp_port'), 10) || 0;
  const secureSetting = db.getSetting('smtp_secure');
  return {
    host: env.host || db.getSetting('smtp_host') || '',
    port,
    secure: env.host ? env.secure : secureSetting === '1' || port === 465,
    user: env.user || db.getSetting('smtp_user') || '',
    pass: env.pass || db.getSetting('smtp_pass') || '',
    from: env.from || db.getSetting('smtp_from') || '',
  };
}

function isEmailConfigured() {
  const { host, from } = getEmailConfig();
  return Boolean(host && from);
}

function setEmailConfig({ host, port, secure, user, pass, from } = {}) {
  if (host !== undefined) db.setSetting('smtp_host', String(host || '').trim());
  if (port !== undefined) db.setSetting('smtp_port', String(parseInt(port, 10) || 0));
  if (secure !== undefined) db.setSetting('smtp_secure', secure ? '1' : '0');
  if (user !== undefined) db.setSetting('smtp_user', String(user || '').trim());
  if (pass !== undefined) db.setSetting('smtp_pass', String(pass || ''));
  if (from !== undefined) db.setSetting('smtp_from', String(from || '').trim());
  notifyChange();
}

// Mask a phone number for display, revealing only the last 4 digits.
function maskPhone(phone) {
  const s = String(phone || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  const last4 = digits.slice(-4);
  return `••• ••• ${last4}`;
}

// Mask an email address, revealing the first character and the domain.
function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s ? '•••' : '';
  const name = s.slice(0, at);
  const domain = s.slice(at);
  const shown = name.slice(0, 1);
  return `${shown}${'•'.repeat(Math.max(1, name.length - 1))}${domain}`;
}

// True when the admin password is pinned via environment variable. In that case
// a database-backed password reset would have no effect (env always wins).
function isPasswordEnvManaged() {
  return Boolean(config.admin.password);
}

// --- Twilio credentials ----------------------------------------------------

function getTwilioCredentials() {
  const env = config.twilio;
  return {
    accountSid: env.accountSid || db.getSetting('twilio_account_sid') || '',
    authToken: env.authToken || db.getSetting('twilio_auth_token') || '',
    phoneNumber:
      env.phoneNumber ||
      db.getSetting('twilio_phone_number') ||
      db.getSetting('client_phone_number') ||
      '',
  };
}

function isTwilioConfigured() {
  const { accountSid, authToken } = getTwilioCredentials();
  return Boolean(accountSid && authToken && accountSid.startsWith('AC'));
}

function setTwilioCredentials({ accountSid, authToken, phoneNumber } = {}) {
  if (accountSid !== undefined) db.setSetting('twilio_account_sid', String(accountSid || '').trim());
  if (authToken !== undefined) db.setSetting('twilio_auth_token', String(authToken || '').trim());
  if (phoneNumber !== undefined)
    db.setSetting('twilio_phone_number', String(phoneNumber || '').trim());
  notifyChange();
}

// Verify a set of Twilio credentials by fetching the account over the API.
async function testTwilioCredentials(creds) {
  const { accountSid, authToken } = creds && creds.accountSid ? creds : getTwilioCredentials();
  if (!accountSid || !authToken || !accountSid.startsWith('AC')) {
    return { ok: false, error: 'Enter a valid Account SID (starts with "AC") and Auth Token.' };
  }
  let twilio;
  try {
    // eslint-disable-next-line global-require
    twilio = require('twilio');
  } catch {
    return { ok: false, error: 'Twilio library is not installed on the server.' };
  }
  try {
    const client = twilio(accountSid, authToken);
    const account = await client.api.accounts(accountSid).fetch();
    return { ok: true, friendlyName: account.friendlyName, status: account.status };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not connect to Twilio.' };
  }
}

// --- Admin password --------------------------------------------------------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPasswordHash(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(pw), salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function getAdminUser() {
  if (config.admin.password) return config.admin.user;
  return db.getSetting('admin_user') || config.admin.user || 'admin';
}

function setAdminCredentials({ user, password }) {
  if (user !== undefined) db.setSetting('admin_user', String(user || 'admin').trim() || 'admin');
  if (password) db.setSetting('admin_password_hash', hashPassword(password));
}

function isAdminConfiguredViaDb() {
  return Boolean(db.getSetting('admin_password_hash'));
}

// Whether any admin protection is active (env password/token or a DB password).
function isAuthConfigured() {
  return Boolean(config.admin.password || config.admin.token || isAdminConfiguredViaDb());
}

// Verify HTTP Basic credentials against env (preferred) or the stored hash.
function verifyAdminLogin(user, password) {
  if (config.admin.password) {
    const uOk = safeEqual(user, config.admin.user);
    const pOk = safeEqual(password, config.admin.password);
    return uOk && pOk;
  }
  const hash = db.getSetting('admin_password_hash');
  if (!hash) return false;
  const expectedUser = db.getSetting('admin_user') || 'admin';
  return safeEqual(user, expectedUser) && verifyPasswordHash(password, hash);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Setup state -----------------------------------------------------------

function isSetupComplete() {
  // Env-configured deployments are considered already set up.
  return db.getSetting('setup_complete') === '1' || Boolean(config.admin.password);
}
function markSetupComplete() {
  db.setSetting('setup_complete', '1');
}

function getSetupStatus() {
  return {
    setupComplete: isSetupComplete(),
    businessName: getBusinessName(),
    adminConfigured: isAuthConfigured(),
    twilioConfigured: isTwilioConfigured(),
    smsFromNumber: getTwilioCredentials().phoneNumber || '',
    publicBaseUrl: config.publicBaseUrl,
    usingLocalhost: /localhost|127\.0\.0\.1/.test(config.publicBaseUrl || ''),
    recoveryPhoneSet: Boolean(getRecoveryPhone()),
    recoveryEmailSet: Boolean(getRecoveryEmail()),
    emailConfigured: isEmailConfigured(),
    passwordEnvManaged: isPasswordEnvManaged(),
  };
}

module.exports = {
  onCredentialsChange,
  getBusinessName,
  setBusinessName,
  getRecoveryPhone,
  setRecoveryPhone,
  getRecoveryEmail,
  setRecoveryEmail,
  getEmailConfig,
  setEmailConfig,
  isEmailConfigured,
  maskPhone,
  maskEmail,
  isPasswordEnvManaged,
  getTwilioCredentials,
  isTwilioConfigured,
  setTwilioCredentials,
  testTwilioCredentials,
  getAdminUser,
  setAdminCredentials,
  isAdminConfiguredViaDb,
  isAuthConfigured,
  verifyAdminLogin,
  isSetupComplete,
  markSetupComplete,
  getSetupStatus,
};
