'use strict';

const config = require('./config');
const db = require('./db');

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

function getClient() {
  if (clientTried) return client;
  clientTried = true;
  const { accountSid, authToken } = config.twilio;
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

function isConfigured() {
  return Boolean(getClient());
}

// The public webhook URL Twilio should call for incoming voice calls.
function getVoiceWebhookUrl() {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}/voice/incoming`;
}

function getStatusCallbackUrl() {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return `${base}/voice/status`;
}

// The number clients should call, persisted in settings (falls back to the
// TWILIO_PHONE_NUMBER env value if nothing has been registered yet).
function getActiveNumber() {
  return db.getSetting('client_phone_number') || config.twilio.phoneNumber || '';
}

function getActiveNumberSid() {
  return db.getSetting('client_phone_number_sid') || '';
}

function setActiveNumber(phoneNumber, sid = '') {
  db.setSetting('client_phone_number', phoneNumber || '');
  db.setSetting('client_phone_number_sid', sid || '');
}

function normalizeNumber(row) {
  return {
    sid: row.sid,
    phoneNumber: row.phoneNumber,
    friendlyName: row.friendlyName,
    voiceUrl: row.voiceUrl,
    voiceMethod: row.voiceMethod,
    // True when this number already routes to our webhook.
    registered: (row.voiceUrl || '') === getVoiceWebhookUrl(),
  };
}

function requireClientError() {
  const err = new Error(
    'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file.'
  );
  err.code = 'TWILIO_NOT_CONFIGURED';
  return err;
}

// Overall status for the UI: whether Twilio is configured, the webhook URL to
// use, the active client number, and whether it is correctly registered.
async function getStatus() {
  const active = getActiveNumber();
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
    const numbers = await listNumbers();
    const match = numbers.find((n) => n.phoneNumber === active || n.sid === getActiveNumberSid());
    status.registered = Boolean(match && match.registered);
  } catch (err) {
    status.error = err.message;
  }
  return status;
}

// List phone numbers owned on the Twilio account.
async function listNumbers() {
  const c = getClient();
  if (!c) throw requireClientError();
  const rows = await c.incomingPhoneNumbers.list({ limit: 50 });
  return rows.map(normalizeNumber);
}

// Register a number the account already owns by pointing its Voice webhook at
// this server. Identify the number by `sid` or `phoneNumber`. Marks it as the
// active client-facing number.
async function registerNumber({ sid, phoneNumber } = {}) {
  const c = getClient();
  if (!c) throw requireClientError();
  if (!sid && !phoneNumber) {
    const err = new Error('Provide a sid or phoneNumber to register.');
    err.code = 'INVALID_INPUT';
    throw err;
  }

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

  const updated = await c.incomingPhoneNumbers(targetSid).update({
    voiceUrl: getVoiceWebhookUrl(),
    voiceMethod: 'POST',
    statusCallback: getStatusCallbackUrl(),
    statusCallbackMethod: 'POST',
  });

  const normalized = normalizeNumber(updated);
  setActiveNumber(normalized.phoneNumber || number, normalized.sid);
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
async function purchaseNumber({ phoneNumber } = {}) {
  const c = getClient();
  if (!c) throw requireClientError();
  if (!phoneNumber) {
    const err = new Error('phoneNumber is required to purchase.');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  const created = await c.incomingPhoneNumbers.create({
    phoneNumber,
    voiceUrl: getVoiceWebhookUrl(),
    voiceMethod: 'POST',
    statusCallback: getStatusCallbackUrl(),
    statusCallbackMethod: 'POST',
  });
  const normalized = normalizeNumber(created);
  setActiveNumber(normalized.phoneNumber, normalized.sid);
  return normalized;
}

module.exports = {
  isConfigured,
  getVoiceWebhookUrl,
  getStatusCallbackUrl,
  getActiveNumber,
  getActiveNumberSid,
  setActiveNumber,
  getStatus,
  listNumbers,
  registerNumber,
  searchAvailable,
  purchaseNumber,
};
