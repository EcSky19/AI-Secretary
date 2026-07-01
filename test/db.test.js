'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  os.tmpdir(),
  `secretary-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;

const db = require('../src/db');
const scheduling = require('../src/scheduling');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

function futureDateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

test('loads default settings and round-trips setting updates', () => {
  assert.deepEqual(db.getSettings(), {
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    appointmentLengthMinutes: 30,
    openDays: [0, 1, 2, 3, 4, 5, 6],
    blackoutDates: [],
    reminderLeadMinutes: 60,
  });

  db.setSetting('appointment_length_minutes', 45);
  assert.equal(db.getSetting('appointment_length_minutes'), '45');
  assert.equal(db.getSettings().appointmentLengthMinutes, 45);

  db.setSetting('appointment_length_minutes', 30);
  assert.equal(db.getSettings().appointmentLengthMinutes, 30);
});

test('booking creates a row, takes the slot, rejects duplicate booking, and cancellation frees it', () => {
  const date = futureDateStr(31);
  const startISO = scheduling.makeStamp(date, '10:00');
  const endISO = scheduling.makeStamp(date, '10:30');

  assert.equal(db.isSlotFree(startISO, endISO), true);

  const appointment = db.bookAppointment({
    name: 'Ada Lovelace',
    phone: '+15551234567',
    reason: 'Consultation',
    startISO,
    endISO,
  });

  assert.ok(appointment.id);
  assert.equal(appointment.name, 'Ada Lovelace');
  assert.equal(appointment.phone, '+15551234567');
  assert.equal(appointment.reason, 'Consultation');
  assert.equal(appointment.start_time, startISO);
  assert.equal(appointment.end_time, endISO);
  assert.equal(appointment.status, 'booked');
  assert.equal(db.isSlotFree(startISO, endISO), false);

  assert.throws(
    () => db.bookAppointment({ name: 'Grace Hopper', phone: '+15557654321', startISO, endISO }),
    (err) => err && err.code === 'SLOT_TAKEN'
  );

  assert.equal(
    scheduling.getAvailableSlots(date, { lengthMinutes: 30 }).some((slot) => slot.startStamp === startISO),
    false
  );

  assert.equal(db.cancelAppointment(appointment.id), true);
  assert.equal(db.isSlotFree(startISO, endISO), true);
  assert.equal(
    scheduling.getAvailableSlots(date, { lengthMinutes: 30 }).some((slot) => slot.startStamp === startISO),
    true
  );
});

test('available slots respect business hours and appointment length', () => {
  db.setSetting('business_hours_start', '09:00');
  db.setSetting('business_hours_end', '17:00');
  db.setSetting('appointment_length_minutes', 30);

  const date = futureDateStr(32);
  const thirtyMinuteSlots = scheduling.getAvailableSlots(date);
  assert.equal(thirtyMinuteSlots.length, 16);
  assert.equal(thirtyMinuteSlots[0].start, '09:00');
  assert.equal(thirtyMinuteSlots[0].end, '09:30');
  assert.equal(thirtyMinuteSlots.at(-1).start, '16:30');
  assert.equal(thirtyMinuteSlots.at(-1).end, '17:00');

  const sixtyMinuteSlots = scheduling.getAvailableSlots(date, { lengthMinutes: 60 });
  assert.equal(sixtyMinuteSlots.length, 8);
  assert.equal(sixtyMinuteSlots[0].start, '09:00');
  assert.equal(sixtyMinuteSlots.at(-1).start, '16:00');
});

test('available slots skip past slots for today', () => {
  db.setSetting('business_hours_start', '00:00');
  db.setSetting('business_hours_end', '23:59');

  const now = scheduling.nowStamp();
  const todaySlots = scheduling.getAvailableSlots(scheduling.todayDateStr(), { lengthMinutes: 1 });

  assert.ok(todaySlots.every((slot) => slot.startStamp >= now));

  if (now > `${scheduling.todayDateStr()}T00:00`) {
    assert.equal(todaySlots.some((slot) => slot.start === '00:00'), false);
  }

  db.setSetting('business_hours_start', '09:00');
  db.setSetting('business_hours_end', '17:00');
});

test('findAppointmentsByPhone returns matching booked appointments', () => {
  const date = futureDateStr(33);
  const first = db.bookAppointment({
    name: 'Linus Torvalds',
    phone: '+15550000001',
    reason: 'Follow up',
    startISO: scheduling.makeStamp(date, '11:00'),
    endISO: scheduling.makeStamp(date, '11:30'),
  });
  db.bookAppointment({
    name: 'Different Caller',
    phone: '+15550000002',
    reason: 'Unrelated',
    startISO: scheduling.makeStamp(date, '12:00'),
    endISO: scheduling.makeStamp(date, '12:30'),
  });

  const matches = db.findAppointmentsByPhone('+15550000001', { upcomingOnly: true });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, first.id);
  assert.equal(matches[0].phone, '+15550000001');
});

test('time helpers and speech formatting return expected values', () => {
  assert.equal(scheduling.timeToMinutes('09:30'), 570);
  assert.equal(scheduling.minutesToTime(570), '09:30');
  assert.equal(scheduling.addMinutesToTime('09:30', 45), '10:15');
  assert.equal(scheduling.makeStamp('2099-01-02', '03:04'), '2099-01-02T03:04');
  assert.equal(scheduling.formatTimeForSpeech('00:00'), '12:00 AM');
  assert.equal(scheduling.formatTimeForSpeech('12:00'), '12:00 PM');
  assert.equal(scheduling.formatTimeForSpeech('15:30'), '3:30 PM');
  assert.match(scheduling.formatStampForSpeech('2099-01-02T15:30'), /January 2 at 3:30 PM$/);
});

test('getNextAvailableSlots scans forward and returns the requested count', () => {
  db.setSetting('business_hours_start', '09:00');
  db.setSetting('business_hours_end', '17:00');
  db.setSetting('appointment_length_minutes', 30);

  const date = futureDateStr(34);
  const slots = scheduling.getNextAvailableSlots(date, 5, 3, 60);

  assert.equal(slots.length, 5);
  assert.ok(slots.every((slot) => slot.startStamp >= `${date}T00:00`));
  assert.deepEqual(
    slots.map((slot) => slot.start).slice(0, 3),
    ['09:00', '10:00', '11:00']
  );
});
