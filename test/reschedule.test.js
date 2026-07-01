'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-reschedule-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

function futureDateStr(daysAhead = 40) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function book(date, time, name = 'Test Caller') {
  return db.bookAppointment({
    name,
    phone: '+15551234567',
    reason: 'Consultation',
    startISO: scheduling.makeStamp(date, time),
    endISO: scheduling.makeStamp(date, scheduling.addMinutesToTime(time, 30)),
  });
}

test('reschedules a booked appointment to a free future slot', () => {
  const date = futureDateStr(40);
  const appointment = book(date, '09:00');
  const newStart = scheduling.makeStamp(date, '10:00');
  const newEnd = scheduling.makeStamp(date, '10:30');

  const updated = db.rescheduleAppointment(appointment.id, newStart, newEnd);

  assert.equal(updated.id, appointment.id);
  assert.equal(updated.start_time, newStart);
  assert.equal(updated.end_time, newEnd);
  assert.equal(updated.status, 'booked');
});

test('rescheduling onto a different booked appointment throws SLOT_TAKEN', () => {
  const date = futureDateStr(41);
  const first = book(date, '09:00', 'First Caller');
  const second = book(date, '11:00', 'Second Caller');

  assert.throws(
    () => db.rescheduleAppointment(first.id, second.start_time, second.end_time),
    (err) => err && err.code === 'SLOT_TAKEN'
  );

  assert.equal(db.getAppointment(first.id).start_time, `${date}T09:00`);
});

test('rescheduling onto its own current slot succeeds', () => {
  const date = futureDateStr(42);
  const appointment = book(date, '12:00');

  const updated = db.rescheduleAppointment(appointment.id, appointment.start_time, appointment.end_time);

  assert.equal(updated.id, appointment.id);
  assert.equal(updated.start_time, appointment.start_time);
  assert.equal(updated.end_time, appointment.end_time);
  assert.equal(db.isSlotFree(appointment.start_time, appointment.end_time, appointment.id), true);
});

test('rescheduling a missing appointment returns null', () => {
  assert.equal(db.rescheduleAppointment(999999, '2099-01-01T09:00', '2099-01-01T09:30'), null);
});

test('rescheduling frees the old slot and takes the new slot', () => {
  const date = futureDateStr(43);
  const oldStart = scheduling.makeStamp(date, '13:00');
  const oldEnd = scheduling.makeStamp(date, '13:30');
  const newStart = scheduling.makeStamp(date, '14:00');
  const newEnd = scheduling.makeStamp(date, '14:30');
  const appointment = book(date, '13:00');

  assert.equal(scheduling.getAvailableSlots(date).some((slot) => slot.startStamp === oldStart), false);

  db.rescheduleAppointment(appointment.id, newStart, newEnd);

  const slots = scheduling.getAvailableSlots(date);
  assert.equal(db.isSlotFree(oldStart, oldEnd), true);
  assert.equal(db.isSlotFree(newStart, newEnd), false);
  assert.equal(slots.some((slot) => slot.startStamp === oldStart), true);
  assert.equal(slots.some((slot) => slot.startStamp === newStart), false);
});
