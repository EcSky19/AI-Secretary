'use strict';

// Seed the database with a few sample appointments for demoing the UI.
const { bookAppointment } = require('../src/db');
const { todayDateStr, makeStamp, addMinutesToTime } = require('../src/scheduling');

const date = todayDateStr();
const samples = [
  { name: 'Alice Johnson', phone: '+15551234567', reason: 'Consultation', start: '10:00' },
  { name: 'Bob Smith', phone: '+15559876543', reason: 'Follow-up', start: '13:30' },
];

for (const s of samples) {
  try {
    const appt = bookAppointment({
      name: s.name,
      phone: s.phone,
      reason: s.reason,
      startISO: makeStamp(date, s.start),
      endISO: makeStamp(date, addMinutesToTime(s.start, 30)),
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded appointment #${appt.id} for ${appt.name} at ${appt.start_time}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`Skipped ${s.name}: ${err.message}`);
  }
}
