'use strict';

const config = require('./config');
const db = require('./db');
const runtimeConfig = require('./runtime-config');
const { nowStamp, formatStampForSpeech } = require('./scheduling');

let timer = null;
let client = null;
let clientKey = '';

// Add `minutes` to a 'YYYY-MM-DDTHH:mm' stamp, returning a stamp. Uses local
// wall-clock arithmetic to stay consistent with the rest of the app.
function addMinutesToStamp(stamp, minutes) {
  const [datePart, timePart] = String(stamp).split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, mi + minutes, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

function getTwilioClient() {
  const { accountSid, authToken } = runtimeConfig.getTwilioCredentials();
  const key = `${accountSid}:${authToken}`;
  if (!accountSid || !authToken || !accountSid.startsWith('AC')) return null;
  if (client && clientKey === key) return client;
  try {
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    client = twilio(accountSid, authToken);
    clientKey = key;
    return client;
  } catch (err) {
    console.error('[reminders] Twilio client init failed:', err.message);
    client = null;
    clientKey = '';
    return null;
  }
}

async function sendReminderSms(to, from, body) {
  const trimmedTo = String(to || '').trim();
  if (!trimmedTo) return { sent: false, reason: 'no-recipient' };
  const c = getTwilioClient();
  if (!c) {
    console.log(`[reminders] (SMS disabled) would text ${trimmedTo} from ${from}: ${body}`);
    return { sent: false, reason: 'not-configured' };
  }
  const message = await c.messages.create({ to: trimmedTo, from, body });
  return { sent: true, sid: message.sid };
}

async function processTenant(tenant, now) {
  const tenantId = tenant.id;
  const leadMinutes = db.getSettings(tenantId).reminderLeadMinutes || config.reminders.leadMinutes;
  const until = addMinutesToStamp(now, leadMinutes);
  const due = db.listAppointmentsNeedingReminder(now, until, tenantId);
  const from = runtimeConfig.getTenantFromNumber(tenantId);

  let sent = 0;
  for (const appt of due) {
    // Mark first to avoid double-processing if a later step throws or a tenant has no number.
    db.markReminderSent(appt.id, tenantId);
    if (!from) {
      console.log(`[reminders] skipping appointment ${appt.id} for tenant ${tenantId}: no assigned number`);
      continue;
    }
    try {
      const when = formatStampForSpeech ? formatStampForSpeech(appt.start_time) : appt.start_time;
      const result = await sendReminderSms(
        appt.phone,
        from,
        `Reminder: your appointment is coming up at ${when}. Reply or call to make changes.`
      );
      if (result && result.sent) sent += 1;
    } catch (err) {
      console.error(`[reminders] failed for appointment ${appt.id} tenant ${tenantId}:`, err.message);
    }
  }
  return sent;
}

// Send reminders for all tenants. Returns the number of SMS messages sent. Safe to call repeatedly.
async function runOnce() {
  const now = nowStamp();
  let sent = 0;
  for (const tenant of db.listTenants()) {
    sent += await processTenant(tenant, now);
  }
  return sent;
}

// Start the periodic reminder poller. No-op when disabled.
function startReminders() {
  if (timer || !config.reminders.enabled) return;
  const intervalMs = Math.max(5, config.reminders.pollSeconds) * 1000;
  timer = setInterval(() => {
    runOnce().catch((err) => console.error('[reminders] poll error:', err.message));
  }, intervalMs);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
}

function stopReminders() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startReminders, stopReminders, runOnce, addMinutesToStamp };
