'use strict';

const runtimeConfig = require('./runtime-config');

// Lazily-created Twilio REST client (only when credentials are configured).
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

// Returns true if SMS sending is configured.
function isSmsEnabled() {
  return Boolean(getClient() && runtimeConfig.getTwilioCredentials().phoneNumber);
}

// Send an SMS. If Twilio is not configured, logs the message instead of failing
// so the rest of the app keeps working (e.g. in local development).
async function sendSms(to, body) {
  const trimmedTo = String(to || '').trim();
  if (!trimmedTo) return { sent: false, reason: 'no-recipient' };

  const c = getClient();
  const from = runtimeConfig.getTwilioCredentials().phoneNumber;
  if (!c || !from) {
    console.log(`[notify] (SMS disabled) would text ${trimmedTo}: ${body}`);
    return { sent: false, reason: 'not-configured' };
  }

  try {
    const message = await c.messages.create({
      to: trimmedTo,
      from,
      body,
    });
    return { sent: true, sid: message.sid };
  } catch (err) {
    console.error(`[notify] SMS to ${trimmedTo} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// Convenience helpers for common appointment notifications. All are safe to
// call regardless of whether SMS is configured.
async function notifyBooked(appointment, formatStamp) {
  if (!appointment || !appointment.phone) return { sent: false, reason: 'no-phone' };
  const when = formatStamp ? formatStamp(appointment.start_time) : appointment.start_time;
  return sendSms(
    appointment.phone,
    `Your appointment is confirmed for ${when}. Reply or call to make changes.`
  );
}

async function notifyRescheduled(appointment, formatStamp) {
  if (!appointment || !appointment.phone) return { sent: false, reason: 'no-phone' };
  const when = formatStamp ? formatStamp(appointment.start_time) : appointment.start_time;
  return sendSms(appointment.phone, `Your appointment has been moved to ${when}.`);
}

async function notifyCancelled(appointment, formatStamp) {
  if (!appointment || !appointment.phone) return { sent: false, reason: 'no-phone' };
  const when = formatStamp ? formatStamp(appointment.start_time) : appointment.start_time;
  return sendSms(appointment.phone, `Your appointment for ${when} has been cancelled.`);
}

module.exports = {
  isSmsEnabled,
  sendSms,
  notifyBooked,
  notifyRescheduled,
  notifyCancelled,
};
