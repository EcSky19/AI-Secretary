'use strict';

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

// ---------------------------------------------------------------------------
// Runtime configuration
//
// Settings are tenant-scoped. For backwards compatibility, every tenantId
// parameter is optional and defaults to the migrated default tenant.
// ---------------------------------------------------------------------------

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

function tenantIdOrDefault(tenantId) {
  return db.resolveTenantId(tenantId);
}

// --- Business profile ------------------------------------------------------

function getBusinessName(tenantId) {
  const id = tenantIdOrDefault(tenantId);
  const tenant = db.getTenantById(id);
  return (tenant && tenant.business_name) || db.getSetting(id, 'business_name') || 'AI Secretary';
}
function setBusinessName(name, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  const value = String(name || '').trim();
  db.setSetting(id, 'business_name', value);
  db.setTenantBusinessName(id, value);
}

function getBusinessHours(tenantId) {
  const settings = db.getSettings(tenantIdOrDefault(tenantId));
  return {
    start: settings.businessHoursStart,
    end: settings.businessHoursEnd,
    appointmentLengthMinutes: settings.appointmentLengthMinutes,
    openDays: settings.openDays,
    blackoutDates: settings.blackoutDates,
  };
}
function setBusinessHours({ start, end, appointmentLengthMinutes, openDays, blackoutDates } = {}, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  if (start !== undefined) db.setSetting(id, 'business_hours_start', String(start || '').trim());
  if (end !== undefined) db.setSetting(id, 'business_hours_end', String(end || '').trim());
  if (appointmentLengthMinutes !== undefined) {
    db.setSetting(id, 'appointment_length_minutes', String(parseInt(appointmentLengthMinutes, 10) || 0));
  }
  if (openDays !== undefined) db.setSetting(id, 'open_days', Array.isArray(openDays) ? openDays.join(',') : String(openDays || ''));
  if (blackoutDates !== undefined) {
    db.setSetting(id, 'blackout_dates', Array.isArray(blackoutDates) ? blackoutDates.join(',') : String(blackoutDates || ''));
  }
}

// --- Recovery phone (for password reset by SMS) ----------------------------

function getRecoveryPhone(tenantId) {
  return db.getSetting(tenantIdOrDefault(tenantId), 'recovery_phone') || '';
}
function setRecoveryPhone(phone, tenantId) {
  db.setSetting(tenantIdOrDefault(tenantId), 'recovery_phone', String(phone || '').trim());
}

// --- Recovery email (for password reset by email) --------------------------

function getRecoveryEmail(tenantId) {
  return db.getSetting(tenantIdOrDefault(tenantId), 'recovery_email') || '';
}
function setRecoveryEmail(email, tenantId) {
  db.setSetting(tenantIdOrDefault(tenantId), 'recovery_email', String(email || '').trim());
}

// --- Email / SMTP settings -------------------------------------------------

function getEmailConfig(tenantId) {
  const id = tenantIdOrDefault(tenantId);
  const env = config.email;
  const port = env.port || parseInt(db.getSetting(id, 'smtp_port'), 10) || 0;
  const secureSetting = db.getSetting(id, 'smtp_secure');
  return {
    host: env.host || db.getSetting(id, 'smtp_host') || '',
    port,
    secure: env.host ? env.secure : secureSetting === '1' || port === 465,
    user: env.user || db.getSetting(id, 'smtp_user') || '',
    pass: env.pass || db.getSetting(id, 'smtp_pass') || '',
    from: env.from || db.getSetting(id, 'smtp_from') || '',
  };
}

function isEmailConfigured(tenantId) {
  const { host, from } = getEmailConfig(tenantId);
  return Boolean(host && from);
}

function setEmailConfig({ host, port, secure, user, pass, from } = {}, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  if (host !== undefined) db.setSetting(id, 'smtp_host', String(host || '').trim());
  if (port !== undefined) db.setSetting(id, 'smtp_port', String(parseInt(port, 10) || 0));
  if (secure !== undefined) db.setSetting(id, 'smtp_secure', secure ? '1' : '0');
  if (user !== undefined) db.setSetting(id, 'smtp_user', String(user || '').trim());
  if (pass !== undefined) db.setSetting(id, 'smtp_pass', String(pass || ''));
  if (from !== undefined) db.setSetting(id, 'smtp_from', String(from || '').trim());
  notifyChange();
}

function maskPhone(phone) {
  const s = String(phone || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  const last4 = digits.slice(-4);
  return `••• ••• ${last4}`;
}

function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return s ? '•••' : '';
  const name = s.slice(0, at);
  const domain = s.slice(at);
  const shown = name.slice(0, 1);
  return `${shown}${'•'.repeat(Math.max(1, name.length - 1))}${domain}`;
}

function isPasswordEnvManaged() {
  return Boolean(config.admin.password);
}

// --- Assistant voice (Twilio text-to-speech) -------------------------------

const DEFAULT_VOICE = 'Polly.Joanna-Neural';

const VOICE_OPTIONS = [
  { name: 'Polly.Joanna-Neural', label: 'Joanna — US English, female (recommended)' },
  { name: 'Polly.Matthew-Neural', label: 'Matthew — US English, male' },
  { name: 'Polly.Danielle-Neural', label: 'Danielle — US English, female' },
  { name: 'Polly.Stephen-Neural', label: 'Stephen — US English, male' },
  { name: 'Polly.Amy-Neural', label: 'Amy — British English, female' },
  { name: 'Polly.Brian-Neural', label: 'Brian — British English, male' },
  { name: 'Polly.Olivia-Neural', label: 'Olivia — Australian English, female' },
];

function getVoiceName(tenantId) {
  if (config.voice.name) return config.voice.name;
  return db.getSetting(tenantIdOrDefault(tenantId), 'voice_name') || DEFAULT_VOICE;
}

function setVoiceName(name, tenantId) {
  db.setSetting(tenantIdOrDefault(tenantId), 'voice_name', String(name || '').trim());
}

function getVoiceOptions() {
  return VOICE_OPTIONS.map((v) => ({ ...v }));
}

function isVoiceEnvManaged() {
  return Boolean(config.voice.name);
}

// --- AI understanding (OpenAI natural-language routing) --------------------

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getOpenAiConfig(tenantId) {
  const id = tenantIdOrDefault(tenantId);
  return {
    apiKey: config.openai.apiKey || db.getSetting(id, 'openai_api_key') || '',
    model: process.env.OPENAI_MODEL || db.getSetting(id, 'openai_model') || DEFAULT_OPENAI_MODEL,
  };
}

function isAiUnderstandingEnabled(tenantId) {
  return Boolean(getOpenAiConfig(tenantId).apiKey);
}

function isOpenAiEnvManaged() {
  return Boolean(config.openai.apiKey);
}

function setOpenAiConfig({ apiKey, model } = {}, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  if (apiKey !== undefined) db.setSetting(id, 'openai_api_key', String(apiKey || '').trim());
  if (model !== undefined) db.setSetting(id, 'openai_model', String(model || '').trim());
  notifyChange();
}

// --- Twilio credentials ----------------------------------------------------

function getTenantFromNumber(tenantId) {
  const tenant = db.getTenantById(tenantIdOrDefault(tenantId));
  return (tenant && tenant.twilio_phone_number) || '';
}

function getTwilioCredentials(tenantId) {
  const id = tenantIdOrDefault(tenantId);
  const env = config.twilio;
  return {
    accountSid: env.accountSid || db.getSetting(id, 'twilio_account_sid') || '',
    authToken: env.authToken || db.getSetting(id, 'twilio_auth_token') || '',
    phoneNumber:
      env.phoneNumber ||
      getTenantFromNumber(id) ||
      db.getSetting(id, 'twilio_phone_number') ||
      db.getSetting(id, 'client_phone_number') ||
      '',
  };
}

function isTwilioConfigured(tenantId) {
  const { accountSid, authToken } = getTwilioCredentials(tenantId);
  return Boolean(accountSid && authToken && accountSid.startsWith('AC'));
}

function setTwilioCredentials({ accountSid, authToken, phoneNumber } = {}, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  if (accountSid !== undefined) db.setSetting(id, 'twilio_account_sid', String(accountSid || '').trim());
  if (authToken !== undefined) db.setSetting(id, 'twilio_auth_token', String(authToken || '').trim());
  if (phoneNumber !== undefined) {
    const value = String(phoneNumber || '').trim();
    db.setSetting(id, 'twilio_phone_number', value);
    db.assignTenantPhone(id, value || null);
  }
  notifyChange();
}

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

function getAdminUser(tenantId) {
  if (config.admin.password) return config.admin.user;
  return db.getSetting(tenantIdOrDefault(tenantId), 'admin_user') || config.admin.user || 'admin';
}

function setAdminCredentials({ user, password }, tenantId) {
  const id = tenantIdOrDefault(tenantId);
  const nextUser = String(user || 'admin').trim() || 'admin';
  if (user !== undefined) db.setSetting(id, 'admin_user', nextUser);
  if (password) db.setSetting(id, 'admin_password_hash', hashPassword(password));
}

function isAdminConfiguredViaDb(tenantId) {
  return Boolean(db.getSetting(tenantIdOrDefault(tenantId), 'admin_password_hash'));
}

function hasSignedUpTenants() {
  // db.js does not expose a user count; tenant signups create non-default tenants.
  return db.listTenants().some((tenant) => tenant.slug !== 'default');
}

function isAuthConfigured(tenantId) {
  return Boolean(
    config.admin.password ||
    config.admin.token ||
    isAdminConfiguredViaDb(tenantId) ||
    hasSignedUpTenants() ||
    process.env.NODE_ENV === 'production' ||
    process.env.AUTH_REQUIRED === 'true'
  );
}

function verifyAdminLogin(user, password, tenantId) {
  if (config.admin.password) {
    const uOk = safeEqual(user, config.admin.user);
    const pOk = safeEqual(password, config.admin.password);
    return uOk && pOk;
  }
  const id = tenantIdOrDefault(tenantId);
  const hash = db.getSetting(id, 'admin_password_hash');
  if (!hash) return false;
  const expectedUser = db.getSetting(id, 'admin_user') || 'admin';
  return safeEqual(user, expectedUser) && verifyPasswordHash(password, hash);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Setup state -----------------------------------------------------------

function isSetupComplete(tenantId) {
  return db.getSetting(tenantIdOrDefault(tenantId), 'setup_complete') === '1' || Boolean(config.admin.password);
}
function markSetupComplete(tenantId) {
  db.setSetting(tenantIdOrDefault(tenantId), 'setup_complete', '1');
}

function getSetupStatus(tenantId) {
  const id = tenantIdOrDefault(tenantId);
  return {
    setupComplete: isSetupComplete(id),
    businessName: getBusinessName(id),
    adminConfigured: isAuthConfigured(id),
    twilioConfigured: isTwilioConfigured(id),
    smsFromNumber: getTwilioCredentials(id).phoneNumber || '',
    publicBaseUrl: config.publicBaseUrl,
    usingLocalhost: /localhost|127\.0\.0\.1/.test(config.publicBaseUrl || ''),
    recoveryPhoneSet: Boolean(getRecoveryPhone(id)),
    recoveryEmailSet: Boolean(getRecoveryEmail(id)),
    emailConfigured: isEmailConfigured(id),
    passwordEnvManaged: isPasswordEnvManaged(),
  };
}

module.exports = {
  onCredentialsChange,
  getBusinessName,
  setBusinessName,
  getBusinessHours,
  setBusinessHours,
  getRecoveryPhone,
  setRecoveryPhone,
  getRecoveryEmail,
  setRecoveryEmail,
  getEmailConfig,
  setEmailConfig,
  isEmailConfigured,
  getVoiceName,
  setVoiceName,
  getVoiceOptions,
  isVoiceEnvManaged,
  getOpenAiConfig,
  isAiUnderstandingEnabled,
  isOpenAiEnvManaged,
  setOpenAiConfig,
  maskPhone,
  maskEmail,
  isPasswordEnvManaged,
  getTwilioCredentials,
  getTenantFromNumber,
  isTwilioConfigured,
  setTwilioCredentials,
  testTwilioCredentials,
  hashPassword,
  verifyPasswordHash,
  getAdminUser,
  setAdminCredentials,
  isAdminConfiguredViaDb,
  isAuthConfigured,
  verifyAdminLogin,
  isSetupComplete,
  markSetupComplete,
  getSetupStatus,
};
