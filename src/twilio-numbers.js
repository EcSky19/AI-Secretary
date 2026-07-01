'use strict';

const config = require('./config');
const db = require('./db');
const runtimeConfig = require('./runtime-config');

// ---------------------------------------------------------------------------
// Twilio phone number management.
//
// This module lets an operator register the phone number that clients will
// call. "Registering" a number means pointing that Twilio number's Voice
// webhook at THIS server's /voice/incoming endpoint, so incoming calls are
// answered by the AI secretary. The active client-facing number is persisted
// in settings so the UI can display it.
//
// All functions degrade gracefully when Twilio credentials are not configured
// (they never throw for missing credentials; instead they report status), so
// the app remains fully usable for local development without Twilio.
// ---------------------------------------------------------------------------

let client = null;
let clientTried = false;

// Rebuild the client when credentials change at runtime.
runtimeConfig.onCredentialsChange(() => {
  client = null;
  clientTried = false;
});

function getClient() {
  if (clientTried) return client;
  clientTried = true;
  const { accountSid, authToken } = runtimeConfig.getTwilioCredentials();
  if (accountSid && authToken && accountSid.startsWith('AC')) {
    try {
      // eslint-disable-next-line global-require
      const twilio = require('twilio');
      client = twilio(accountSid, authToken);
    } catch (err) {
      console.error('Twilio client init failed:', err.message);
      client = null;
    }
  }
  return client;
}

function getPlatformClient() {
  const { accountSid, authToken } = config.twilio;
  if (!accountSid || !authToken || !accountSid.startsWith('AC')) return null;
  return getClient();
}

function isConfigured() {
  return Boolean(getClient());
}

// The public webhook URL Twilio should call for incoming voice calls.
function getVoiceWebhookUrl() {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}/voice/incoming`;
}

function getProvisioningVoiceWebhookUrl() {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}/voice`;
}

function getStatusCallbackUrl() {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}/voice/status`;
}

// The number clients should call. Tenant-aware callers read from the tenant
// assignment first; legacy callers without tenantId keep the default fallback.
function getActiveNumber(tenantId) {
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    const tenant = db.getTenantById(tenantId);
    return (tenant && tenant.twilio_phone_number) || db.getSetting(tenantId, 'client_phone_number') || '';
  }
  return (
    db.getSetting('client_phone_number') ||
    runtimeConfig.getTwilioCredentials().phoneNumber ||
    ''
  );
}

function getActiveNumberSid(tenantId) {
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    return db.getSetting(tenantId, 'client_phone_number_sid') || '';
  }
  return db.getSetting('client_phone_number_sid') || '';
}

function setActiveNumber(tenantIdOrPhoneNumber, phoneNumberOrSid = '', maybeSid = '') {
  if (maybeSid === '' && (tenantIdOrPhoneNumber === undefined || String(tenantIdOrPhoneNumber).startsWith('+'))) {
    const tenantId = db.resolveDefaultTenantId();
    const phoneNumber = tenantIdOrPhoneNumber;
    const sid = phoneNumberOrSid;
    if (phoneNumber) ensureNumberAssignable(tenantId, phoneNumber);
    db.assignTenantPhone(tenantId, phoneNumber || null);
    db.setSetting(tenantId, 'client_phone_number', phoneNumber || '');
    db.setSetting(tenantId, 'client_phone_number_sid', sid || '');
    return db.getTenantById(tenantId);
  }

  const tenantId = tenantIdOrPhoneNumber;
  const phoneNumber = phoneNumberOrSid;
  const sid = maybeSid;
  ensureTenant(tenantId);
  if (phoneNumber) ensureNumberAssignable(tenantId, phoneNumber);
  const tenant = db.assignTenantPhone(tenantId, phoneNumber || null);
  db.setSetting(tenantId, 'client_phone_number', phoneNumber || '');
  db.setSetting(tenantId, 'client_phone_number_sid', sid || '');
  return tenant;
}

function normalizeNumber(row) {
  return {
    sid: row.sid,
    phoneNumber: row.phoneNumber,
    friendlyName: row.friendlyName,
    voiceUrl: row.voiceUrl,
    voiceMethod: row.voiceMethod,
    // True when this number already routes to our webhook.
    registered: [getVoiceWebhookUrl(), getProvisioningVoiceWebhookUrl()].includes(row.voiceUrl || ''),
  };
}

function requireClientError() {
  const err = new Error(
    'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file.'
  );
  err.code = 'TWILIO_NOT_CONFIGURED';
  return err;
}

function structuredError(err, fallbackCode = 'TWILIO_ERROR') {
  const code = err && (err.code || err.status || err.name) ? String(err.code || err.status || err.name) : fallbackCode;
  return {
    ok: false,
    error: {
      code,
      message: err && err.message ? err.message : String(err || 'Unknown Twilio error'),
    },
  };
}

function ok(payload) {
  return { ok: true, ...payload };
}

function normalizeE164(phoneNumber) {
  return String(phoneNumber || '').trim();
}

function normalizeAvailableNumber(row) {
  return {
    phoneNumber: row.phoneNumber,
    friendlyName: row.friendlyName,
    locality: row.locality,
    region: row.region,
  };
}

function provisioningWebhookConfig() {
  return {
    voiceUrl: getProvisioningVoiceWebhookUrl(),
    voiceMethod: 'POST',
    statusCallback: getStatusCallbackUrl(),
    statusCallbackMethod: 'POST',
  };
}

function ensureTenant(tenantId) {
  const tenant = db.getTenantById(tenantId);
  if (!tenant) {
    const err = new Error(`Tenant ${tenantId} was not found.`);
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }
  return tenant;
}

function ensureNumberAssignable(tenantId, e164) {
  const existing = db.getTenantByPhone(e164);
  if (existing && Number(existing.id) !== Number(tenantId)) {
    const err = new Error(`Phone number ${e164} is already assigned to another tenant.`);
    err.code = 'NUMBER_ALREADY_ASSIGNED';
    throw err;
  }
}

// Overall status for the UI: whether Twilio is configured, the webhook URL to
// use, the active client number, and whether it is correctly registered.
async function getStatus(tenantId) {
  const active = getActiveNumber(tenantId);
  const status = {
    configured: isConfigured(),
    webhookUrl: getVoiceWebhookUrl(),
    publicBaseUrl: config.publicBaseUrl,
    usingLocalhost: /localhost|127\.0\.0\.1/.test(config.publicBaseUrl || ''),
    activeNumber: active,
    registered: false,
  };
  if (!status.configured || !active) return status;
  try {
    const numbers = await listNumbers(tenantId);
    const match = numbers.find((n) => n.phoneNumber === active || n.sid === getActiveNumberSid(tenantId));
    status.registered = Boolean(match && match.registered);
  } catch (err) {
    status.error = err.message;
  }
  return status;
}

// List phone numbers owned on the Twilio account.
async function listNumbers(tenantId) {
  const c = getClient();
  if (!c) throw requireClientError();
  const rows = await c.incomingPhoneNumbers.list({ limit: 50 });
  const active = tenantId !== undefined && tenantId !== null && tenantId !== '' ? getActiveNumber(tenantId) : '';
  return rows.map((row) => {
    const normalized = normalizeNumber(row);
    if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
      normalized.assigned = normalized.phoneNumber === active;
    }
    return normalized;
  });
}

// Register a number the account already owns by pointing its Voice webhook at
// this server. Identify the number by `sid` or `phoneNumber`. Marks it as the
// active client-facing number.
async function registerNumber({ sid, phoneNumber, tenantId } = {}) {
  if (!sid && !phoneNumber) {
    const err = new Error('Provide a sid or phoneNumber to register.');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    ensureTenant(tenantId);
    if (!phoneNumber) {
      const err = new Error('phoneNumber is required when assigning a number to a tenant.');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    ensureNumberAssignable(tenantId, phoneNumber);
  }

  const c = getClient();
  if (!c) throw requireClientError();

  let targetSid = sid;
  let number = phoneNumber;

  if (!targetSid) {
    const matches = await c.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    if (!matches.length) {
      const err = new Error(`No owned Twilio number matches ${phoneNumber}.`);
      err.code = 'NUMBER_NOT_FOUND';
      throw err;
    }
    targetSid = matches[0].sid;
    number = matches[0].phoneNumber;
  }
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    ensureNumberAssignable(tenantId, number);
  }

  const updated = await c.incomingPhoneNumbers(targetSid).update({
    voiceUrl: getVoiceWebhookUrl(),
    voiceMethod: 'POST',
    statusCallback: getStatusCallbackUrl(),
    statusCallbackMethod: 'POST',
  });

  const normalized = normalizeNumber(updated);
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    setActiveNumber(tenantId, normalized.phoneNumber || number, normalized.sid);
  } else {
    setActiveNumber(normalized.phoneNumber || number, normalized.sid);
  }
  return normalized;
}

// Search available numbers to purchase.
async function searchAvailable({ country = 'US', areaCode, contains, limit = 10 } = {}) {
  const c = getClient();
  if (!c) throw requireClientError();
  const opts = { limit };
  if (areaCode) opts.areaCode = areaCode;
  if (contains) opts.contains = contains;
  const rows = await c.availablePhoneNumbers(country).local.list(opts);
  return rows.map((r) => ({
    phoneNumber: r.phoneNumber,
    friendlyName: r.friendlyName,
    locality: r.locality,
    region: r.region,
  }));
}

// Purchase a number and immediately register it to this server's webhook.
async function purchaseNumber({ phoneNumber, tenantId } = {}) {
  if (!phoneNumber) {
    const err = new Error('phoneNumber is required to purchase.');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    ensureTenant(tenantId);
    ensureNumberAssignable(tenantId, phoneNumber);
  }
  const c = getClient();
  if (!c) throw requireClientError();
  const created = await c.incomingPhoneNumbers.create({
    phoneNumber,
    voiceUrl: getVoiceWebhookUrl(),
    voiceMethod: 'POST',
    statusCallback: getStatusCallbackUrl(),
    statusCallbackMethod: 'POST',
  });
  const normalized = normalizeNumber(created);
  if (tenantId !== undefined && tenantId !== null && tenantId !== '') {
    setActiveNumber(tenantId, normalized.phoneNumber, normalized.sid);
  } else {
    setActiveNumber(normalized.phoneNumber, normalized.sid);
  }
  return normalized;
}

/**
 * listAvailableNumbers({ areaCode, contains, country }?)
 * Searches Twilio AvailablePhoneNumbers using the platform master account.
 * Returns { ok: true, numbers: [{ phoneNumber, friendlyName, locality, region }] }
 * or { ok: false, error: { code, message } } when Twilio is unavailable.
 */
async function listAvailableNumbers({ country = 'US', areaCode, contains, limit = 10, tenantId } = {}) {
  const c = getPlatformClient();
  if (!c) return structuredError(requireClientError());
  try {
    const active = tenantId !== undefined && tenantId !== null && tenantId !== '' ? getActiveNumber(tenantId) : '';
    const opts = { limit };
    if (areaCode) opts.areaCode = String(areaCode);
    if (contains) opts.contains = String(contains);
    const rows = await c.availablePhoneNumbers(country || 'US').local.list(opts);
    return ok({
      numbers: rows.map((row) => ({
        ...normalizeAvailableNumber(row),
        ...(tenantId !== undefined && tenantId !== null && tenantId !== '' ? { assigned: row.phoneNumber === active } : {}),
      })),
    });
  } catch (err) {
    return structuredError(err);
  }
}

async function findOwnedNumber(c, e164) {
  const matches = await c.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  return matches && matches.length ? matches[0] : null;
}

async function configureOwnedNumber(c, numberOrSid) {
  const sid = typeof numberOrSid === 'string' ? numberOrSid : numberOrSid.sid;
  return c.incomingPhoneNumbers(sid).update(provisioningWebhookConfig());
}

async function assignTenantNumber(tenantId, e164) {
  ensureNumberAssignable(tenantId, e164);
  const tenant = db.assignTenantPhone(tenantId, e164);
  return tenant;
}

/**
 * provisionNumberForTenant(tenantId, { areaCode, contains }?)
 * Buys the first matching available number on the platform master account,
 * configures it for this app's /voice webhook, and assigns it to the tenant.
 * Returns { ok: true, number, tenant } or { ok: false, error: { code, message } }.
 */
async function provisionNumberForTenant(tenantId, { areaCode, contains, country = 'US' } = {}) {
  let created = null;
  let c = null;
  try {
    const tenant = ensureTenant(tenantId);
    ensureNumberAssignable(tenant.id, tenant.twilio_phone_number || '');
    c = getPlatformClient();
    if (!c) throw requireClientError();

    const available = await c.availablePhoneNumbers(country || 'US').local.list({
      limit: 1,
      ...(areaCode ? { areaCode: String(areaCode) } : {}),
      ...(contains ? { contains: String(contains) } : {}),
    });
    if (!available.length) {
      const err = new Error('No Twilio phone numbers matched the requested filters.');
      err.code = 'NO_AVAILABLE_NUMBERS';
      throw err;
    }

    created = await c.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      ...provisioningWebhookConfig(),
    });
    const normalized = normalizeNumber(created);
    const assignedTenant = assignTenantNumber(tenant.id, normalized.phoneNumber);
    return ok({ number: normalized, tenant: assignedTenant });
  } catch (err) {
    if (created && created.sid) {
      try {
        await c.incomingPhoneNumbers(created.sid).remove();
      } catch (cleanupErr) {
        err.cleanupError = cleanupErr.message;
      }
    }
    return structuredError(err);
  }
}

/**
 * assignExistingNumberToTenant(tenantId, e164)
 * Configures an already-owned platform Twilio number for this app's /voice
 * webhook, then assigns it to one tenant only.
 * Returns { ok: true, number, tenant } or { ok: false, error: { code, message } }.
 */
async function assignExistingNumberToTenant(tenantId, e164) {
  try {
    const phoneNumber = normalizeE164(e164);
    if (!phoneNumber) {
      const err = new Error('e164 phone number is required.');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const tenant = ensureTenant(tenantId);
    ensureNumberAssignable(tenant.id, phoneNumber);
    const c = getPlatformClient();
    if (!c) throw requireClientError();

    const owned = await findOwnedNumber(c, phoneNumber);
    if (!owned) {
      const err = new Error(`No owned Twilio number matches ${phoneNumber}.`);
      err.code = 'NUMBER_NOT_FOUND';
      throw err;
    }

    const updated = await configureOwnedNumber(c, owned);
    const normalized = normalizeNumber(updated);
    const assignedTenant = assignTenantNumber(tenant.id, normalized.phoneNumber || phoneNumber);
    return ok({ number: normalized, tenant: assignedTenant });
  } catch (err) {
    return structuredError(err);
  }
}

/**
 * releaseTenantNumber(tenantId)
 * Clears this app's tenant-to-number assignment only. It does not release the
 * number from the platform Twilio account.
 * Returns { ok: true, tenant } or { ok: false, error: { code, message } }.
 */
async function releaseTenantNumber(tenantId) {
  try {
    const tenant = ensureTenant(tenantId);
    const updated = db.assignTenantPhone(tenant.id, null);
    return ok({ tenant: updated });
  } catch (err) {
    return structuredError(err, 'RELEASE_FAILED');
  }
}

module.exports = {
  isConfigured,
  getVoiceWebhookUrl,
  getProvisioningVoiceWebhookUrl,
  getStatusCallbackUrl,
  getActiveNumber,
  getActiveNumberSid,
  setActiveNumber,
  getStatus,
  listNumbers,
  registerNumber,
  searchAvailable,
  purchaseNumber,
  listAvailableNumbers,
  provisionNumberForTenant,
  assignExistingNumberToTenant,
  releaseTenantNumber,
};
