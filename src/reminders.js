'use strict';

const config = require('./config');
const db = require('./db');
const notify = require('./notify');
const { nowStamp, formatStampForSpeech } = require('./scheduling');

let timer = null;

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

// Send reminders for any appointments starting within the configured lead
// window. Returns the number of reminders sent. Safe to call repeatedly.
async function runOnce() {
  const leadMinutes = db.getSettings().reminderLeadMinutes || config.reminders.leadMinutes;
  const now = nowStamp();
  const until = addMinutesToStamp(now, leadMinutes);
  const due = db.listAppointmentsNeedingReminder(now, until);

  let sent = 0;
  for (const appt of due) {
    // Mark first to avoid double-sending if a later step throws.
    db.markReminderSent(appt.id);
    try {
      const when = formatStampForSpeech
        ? formatStampForSpeech(appt.start_time)
        : appt.start_time;
      const result = await notify.sendSms(
        appt.phone,
        `Reminder: your appointment is coming up at ${when}. Reply or call to make changes.`
      );
      if (result && result.sent) sent += 1;
    } catch (err) {
      console.error(`[reminders] failed for appointment ${appt.id}:`, err.message);
    }
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
