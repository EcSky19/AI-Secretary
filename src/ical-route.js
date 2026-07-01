'use strict';

const express = require('express');
const db = require('./db');
const { buildCalendar } = require('./ical');

const router = express.Router();

// Serve all booked appointments as a subscribable .ics feed. Left outside admin
// auth so calendar apps can poll it; guard with ADMIN_TOKEN via ?token= if the
// token check is desired (adminAuth accepts a query token when configured).
router.get('/', (req, res) => {
  const appointments = db.listAppointments({ status: 'booked' });
  const calendar = buildCalendar(appointments);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ai-secretary.ics"');
  res.send(calendar);
});

module.exports = router;
