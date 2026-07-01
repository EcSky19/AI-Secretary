'use strict';

const dbLayer = require('./db');

// All times are handled as naive local "wall-clock" strings to keep the
// scheduling logic simple and timezone-agnostic:
//   date  -> "YYYY-MM-DD"
//   time  -> "HH:mm"
//   stamp -> "YYYY-MM-DDTHH:mm"

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function makeStamp(dateStr, hhmm) {
  return `${dateStr}T${hhmm}`;
}

// Add minutes to a "HH:mm" and return "HH:mm".
function addMinutesToTime(hhmm, minutes) {
  return minutesToTime(timeToMinutes(hhmm) + minutes);
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowStamp() {
  const d = new Date();
  return `${todayDateStr()}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Format a stamp for spoken/display output, e.g. "3:30 PM".
function formatTimeForSpeech(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  let hour = h % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${pad2(m)} ${period}`;
}

// Format a full stamp, e.g. "Monday, July 6 at 3:30 PM".
function formatStampForSpeech(stamp) {
  const [dateStr, hhmm] = stamp.split('T');
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = dt.toLocaleDateString('en-US', { month: 'long' });
  return `${dayName}, ${monthName} ${d} at ${formatTimeForSpeech(hhmm)}`;
}

// Generate every candidate slot for a date based on settings, then filter out
// the ones that overlap an existing booked appointment (and past slots).
function getAvailableSlots(dateStr, opts = {}) {
  // Respect closed weekdays and blackout dates.
  if (!dbLayer.isDateOpen(dateStr)) return [];

  const settings = dbLayer.getSettings();
  const length = opts.lengthMinutes || settings.appointmentLengthMinutes;
  const startMin = timeToMinutes(settings.businessHoursStart);
  const endMin = timeToMinutes(settings.businessHoursEnd);
  const now = nowStamp();

  const slots = [];
  for (let t = startMin; t + length <= endMin; t += length) {
    const startTime = minutesToTime(t);
    const endTime = minutesToTime(t + length);
    const startStamp = makeStamp(dateStr, startTime);
    const endStamp = makeStamp(dateStr, endTime);

    if (startStamp < now) continue; // skip past slots
    if (!dbLayer.isSlotFree(startStamp, endStamp)) continue;

    slots.push({
      date: dateStr,
      start: startTime,
      end: endTime,
      startStamp,
      endStamp,
      label: formatTimeForSpeech(startTime),
    });
  }
  return slots;
}

// Return the first N available slots starting from a given date, scanning
// forward up to `daysAhead` days. Useful for the phone agent's suggestions.
function getNextAvailableSlots(fromDateStr, count = 3, daysAhead = 14, lengthMinutes) {
  const results = [];
  const [y, mo, d] = fromDateStr.split('-').map(Number);
  const cursor = new Date(y, mo - 1, d);

  for (let i = 0; i < daysAhead && results.length < count; i += 1) {
    const dateStr = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(
      cursor.getDate()
    )}`;
    const daySlots = getAvailableSlots(dateStr, { lengthMinutes });
    for (const s of daySlots) {
      results.push(s);
      if (results.length >= count) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

module.exports = {
  pad2,
  timeToMinutes,
  minutesToTime,
  makeStamp,
  addMinutesToTime,
  todayDateStr,
  nowStamp,
  formatTimeForSpeech,
  formatStampForSpeech,
  getAvailableSlots,
  getNextAvailableSlots,
};
