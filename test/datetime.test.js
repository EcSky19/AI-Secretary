'use strict';

const path = require('path');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert');

// Isolate DB (config/scheduling read env at require time).
process.env.DATABASE_PATH = path.join(
  os.tmpdir(),
  `secretary-dtparse-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

const dt = require('../src/datetime-parse');
const scheduling = require('../src/scheduling');

test('parses spoken ordinal month-day dates', () => {
  const today = scheduling.todayDateStr();
  const [y] = today.split('-').map(Number);
  const res = dt.parseDateTime('book on July seventh at 10 AM');
  assert.strictEqual(res.time, '10:00');
  assert.match(res.date, /^\d{4}-07-07$/);
  assert.ok(Number(res.date.slice(0, 4)) >= y);
});

test('parses two-word ordinals and 24h-ish times', () => {
  const res = dt.parseDateTime('the twenty first at 3:30 pm');
  assert.strictEqual(res.time, '15:30');
  assert.match(res.date, /^\d{4}-\d{2}-21$/);
});

test('parses bare hour with preposition using pm heuristic', () => {
  assert.strictEqual(dt.parseTime('tomorrow at 2'), '14:00');
  assert.strictEqual(dt.parseTime('at 9 am'), '09:00');
});

test('parses relative days and parts of day', () => {
  const base = scheduling.todayDateStr();
  assert.strictEqual(dt.parseDate('today please'), base);
  assert.strictEqual(dt.parseTime('sometime in the morning'), '09:00');
  assert.strictEqual(dt.parseTime('noon'), '12:00');
});

test('parses digit ordinal suffixes like the 7th', () => {
  const res = dt.parseDate('on the 7th');
  assert.match(res, /^\d{4}-\d{2}-07$/);
});

test('returns nulls for unparseable input', () => {
  const res = dt.parseDateTime('hello there how are you');
  assert.strictEqual(res.date, null);
  assert.strictEqual(res.time, null);
});
