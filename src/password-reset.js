'use strict';

const crypto = require('crypto');
const db = require('./db');
const runtimeConfig = require('./runtime-config');
const notify = require('./notify');
const email = require('./email');

// ---------------------------------------------------------------------------
// Forgot-password / self-service admin reset.
//
// A locked-out owner requests a one-time code, delivered to a recovery contact
// they saved earlier — by SMS text or by email, whichever they prefer and have
// configured. They enter the code plus a new password to regain access. This
// works entirely from the browser, so non-technical operators never need
// terminal/CLI access. Codes are single-use, short-lived, hashed at rest, and
// rate-limited by an attempt counter.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between code requests

// Settings keys used to persist reset state.
const K_HASH = 'admin_reset_code_hash';
const K_EXPIRES = 'admin_reset_expires';
const K_ATTEMPTS = 'admin_reset_attempts';
const K_LAST_SENT = 'admin_reset_last_sent';

function generateCode() {
  // 6-digit numeric code, zero-padded, drawn from a uniform range.
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function clearReset() {
  db.setSetting(K_HASH, '');
  db.setSetting(K_EXPIRES, '');
  db.setSetting(K_ATTEMPTS, '0');
}

// Availability of the SMS reset channel.
function smsAvailability() {
  if (runtimeConfig.isPasswordEnvManaged()) return { available: false, reason: 'env-managed' };
  if (!runtimeConfig.isAdminConfiguredViaDb()) return { available: false, reason: 'not-configured' };
  if (!runtimeConfig.getRecoveryPhone()) return { available: false, reason: 'no-recovery-phone' };
  if (!notify.isSmsEnabled()) return { available: false, reason: 'sms-unavailable' };
  return { available: true, reason: 'ok' };
}

// Availability of the email reset channel.
function emailAvailability() {
  if (runtimeConfig.isPasswordEnvManaged()) return { available: false, reason: 'env-managed' };
  if (!runtimeConfig.isAdminConfiguredViaDb()) return { available: false, reason: 'not-configured' };
  if (!runtimeConfig.getRecoveryEmail()) return { available: false, reason: 'no-recovery-email' };
  if (!email.isEmailEnabled()) return { available: false, reason: 'email-unavailable' };
  return { available: true, reason: 'ok' };
}

// Availability of each channel plus an overall summary.
function resetAvailability() {
  const sms = smsAvailability();
  const emailCh = emailAvailability();
  const available = sms.available || emailCh.available;
  // A representative reason for the whole feature (used for a single message).
  let reason = 'ok';
  if (!available) {
    if (runtimeConfig.isPasswordEnvManaged()) reason = 'env-managed';
    else if (!runtimeConfig.isAdminConfiguredViaDb()) reason = 'not-configured';
    else reason = 'no-channel';
  }
  return {
    available,
    reason,
    channels: { sms, email: emailCh },
  };
}

// Request a reset code over the chosen channel ('sms' or 'email'). Returns
// { ok, reason, channel, maskedTarget } and, on success, sends a fresh code.
async function requestReset(channel = 'sms') {
  const ch = channel === 'email' ? 'email' : 'sms';
  const availability = ch === 'email' ? emailAvailability() : smsAvailability();
  if (!availability.available) {
    return { ok: false, reason: availability.reason, channel: ch };
  }

  const lastSent = Number(db.getSetting(K_LAST_SENT) || 0);
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - lastSent)) / 1000);
    return { ok: false, reason: 'cooldown', retryAfter, channel: ch };
  }

  const code = generateCode();
  db.setSetting(K_HASH, hashCode(code));
  db.setSetting(K_EXPIRES, String(Date.now() + CODE_TTL_MS));
  db.setSetting(K_ATTEMPTS, '0');
  db.setSetting(K_LAST_SENT, String(Date.now()));

  const business = runtimeConfig.getBusinessName();
  const body = `${business} password reset code: ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`;

  let result;
  let maskedTarget;
  if (ch === 'email') {
    const to = runtimeConfig.getRecoveryEmail();
    maskedTarget = runtimeConfig.maskEmail(to);
    result = await email.sendEmail(to, `${business} password reset code`, body);
  } else {
    const to = runtimeConfig.getRecoveryPhone();
    maskedTarget = runtimeConfig.maskPhone(to);
    result = await notify.sendSms(to, body);
  }

  if (!result.sent) {
    // Don't leave a live code around if we couldn't deliver it.
    clearReset();
    return { ok: false, reason: 'send-failed', channel: ch };
  }

  return { ok: true, channel: ch, maskedTarget, maskedPhone: maskedTarget };
}

// Verify a submitted code and set a new admin password.
// Returns { ok, reason }.
async function verifyAndReset(code, newPassword) {
  if (runtimeConfig.isPasswordEnvManaged()) {
    return { ok: false, reason: 'env-managed' };
  }

  const submitted = String(code || '').trim();
  const pw = String(newPassword || '');
  if (!/^\d{6}$/.test(submitted)) {
    return { ok: false, reason: 'invalid-code' };
  }
  if (pw.length < 6) {
    return { ok: false, reason: 'weak-password' };
  }

  const storedHash = db.getSetting(K_HASH);
  const expires = Number(db.getSetting(K_EXPIRES) || 0);
  if (!storedHash || !expires) {
    return { ok: false, reason: 'no-code' };
  }
  if (Date.now() > expires) {
    clearReset();
    return { ok: false, reason: 'expired' };
  }

  const attempts = Number(db.getSetting(K_ATTEMPTS) || 0);
  if (attempts >= MAX_ATTEMPTS) {
    clearReset();
    return { ok: false, reason: 'too-many-attempts' };
  }

  const submittedHash = hashCode(submitted);
  const a = Buffer.from(submittedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!matches) {
    db.setSetting(K_ATTEMPTS, String(attempts + 1));
    return { ok: false, reason: 'invalid-code', attemptsLeft: MAX_ATTEMPTS - (attempts + 1) };
  }

  runtimeConfig.setAdminCredentials({ password: pw });
  clearReset();
  return { ok: true };
}

module.exports = {
  resetAvailability,
  smsAvailability,
  emailAvailability,
  requestReset,
  verifyAndReset,
  // exported for tests
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
};
