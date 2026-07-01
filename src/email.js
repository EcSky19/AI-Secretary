'use strict';

const runtimeConfig = require('./runtime-config');

// Lazily-created SMTP transport (only when email settings are configured).
let transport = null;
let transportTried = false;

// Rebuild the transport when settings change at runtime.
runtimeConfig.onCredentialsChange(() => {
  transport = null;
  transportTried = false;
});

function getTransport() {
  if (transportTried) return transport;
  transportTried = true;
  const cfg = runtimeConfig.getEmailConfig();
  if (!cfg.host || !cfg.from) return (transport = null);
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch (err) {
    console.error('nodemailer not installed:', err.message);
    return (transport = null);
  }
  try {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  } catch (err) {
    console.error('Email transport init failed:', err.message);
    transport = null;
  }
  return transport;
}

// Returns true if outbound email is configured.
function isEmailEnabled() {
  return Boolean(getTransport() && runtimeConfig.getEmailConfig().from);
}

// Send an email. If email is not configured, logs instead of failing so the
// rest of the app keeps working.
async function sendEmail(to, subject, text) {
  const trimmedTo = String(to || '').trim();
  if (!trimmedTo) return { sent: false, reason: 'no-recipient' };

  const t = getTransport();
  const cfg = runtimeConfig.getEmailConfig();
  if (!t || !cfg.from) {
    console.log(`[email] (email disabled) would email ${trimmedTo}: ${subject}`);
    return { sent: false, reason: 'not-configured' };
  }

  try {
    const info = await t.sendMail({ from: cfg.from, to: trimmedTo, subject, text });
    return { sent: true, id: info.messageId };
  } catch (err) {
    console.error(`[email] to ${trimmedTo} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// Verify the configured (or supplied) SMTP settings by connecting to the server.
async function testEmailConfig(overrides) {
  const cfg = overrides && overrides.host ? overrides : runtimeConfig.getEmailConfig();
  if (!cfg.host || !cfg.from) {
    return { ok: false, error: 'Enter at least an SMTP host and a "from" address.' };
  }
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch {
    return { ok: false, error: 'Email library is not installed on the server.' };
  }
  try {
    const t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not connect to the mail server.' };
  }
}

module.exports = {
  isEmailEnabled,
  sendEmail,
  testEmailConfig,
};
