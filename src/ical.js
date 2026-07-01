'use strict';

const config = require('./config');

function pad(n) {
  return String(n).padStart(2, '0');
}

// Convert a 'YYYY-MM-DDTHH:mm' local wall-clock stamp to an iCalendar
// floating local date-time 'YYYYMMDDTHHMMSS' (no timezone suffix, interpreted
// as local time by calendar clients).
function toICalLocal(stamp) {
  const [datePart, timePart = '00:00'] = String(stamp).split('T');
  const [y, mo, d] = datePart.split('-');
  const [h, mi] = timePart.split(':');
  return `${y}${mo}${d}T${pad(h)}${pad(mi)}00`;
}

function toICalUtcNow() {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold long content lines to 75 octets per RFC 5545.
function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let idx = 0;
  parts.push(line.slice(0, 75));
  idx = 75;
  while (idx < line.length) {
    parts.push(' ' + line.slice(idx, idx + 74));
    idx += 74;
  }
  return parts.join('\r\n');
}

// Build an RFC 5545 VCALENDAR string from a list of appointment rows.
function buildCalendar(appointments = []) {
  const host = (config.publicBaseUrl || 'http://localhost').replace(/^https?:\/\//, '') || 'ai-secretary';
  const dtstamp = toICalUtcNow();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Secretary//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:AI Secretary Appointments',
  ];

  for (const appt of appointments) {
    const summaryBits = [appt.name || 'Appointment'];
    if (appt.reason) summaryBits.push(appt.reason);
    const descBits = [];
    if (appt.phone) descBits.push(`Phone: ${appt.phone}`);
    if (appt.reason) descBits.push(`Reason: ${appt.reason}`);
    if (appt.status) descBits.push(`Status: ${appt.status}`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:appointment-${appt.id}@${host}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toICalLocal(appt.start_time)}`);
    lines.push(`DTEND:${toICalLocal(appt.end_time)}`);
    lines.push(`SUMMARY:${escapeText(summaryBits.join(' - '))}`);
    if (descBits.length) lines.push(`DESCRIPTION:${escapeText(descBits.join('\n'))}`);
    if (appt.status === 'cancelled') lines.push('STATUS:CANCELLED');
    else lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar };
