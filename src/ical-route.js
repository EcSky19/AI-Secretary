'use strict';

const crypto = require('crypto');
const express = require('express');
const auth = require('./auth');
const db = require('./db');
const { buildCalendar } = require('./ical');

const router = express.Router();

function getCalendarToken(tenantId) {
  let token = db.getSetting(tenantId, 'calendar_token');
  if (!token) {
    token = crypto.randomBytes(32).toString('base64url');
    db.setSetting(tenantId, 'calendar_token', token);
  }
  return token;
}

function tenantIdForToken(token) {
  const wanted = String(token || '').trim();
  if (!wanted) return null;
  for (const tenant of db.listTenants()) {
    const token = db.getSetting(tenant.id, 'calendar_token');
    if (token && token === wanted) return tenant.id;
  }
  return null;
}

function sendCalendar(res, tenantId) {
  const appointments = db.listAppointments({ status: 'booked', tenantId });
  const calendar = buildCalendar(appointments);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ai-secretary.ics"');
  res.send(calendar);
}

function serveToken(req, res) {
  const token = req.params.token || req.query.t || req.query.token;
  const tenantId = tenantIdForToken(token);
  if (!tenantId) return res.status(404).send('Not found');
  return sendCalendar(res, tenantId);
}

router.get('/:token.ics', serveToken);

router.get('/', (req, res) => {
  const token = req.query.t || req.query.token;
  if (token) return serveToken(req, res);

  if (!auth.isAuthEnabled()) {
    return sendCalendar(res, db.resolveDefaultTenantId());
  }

  const defaultTenantId = db.resolveDefaultTenantId();
  if (db.listAppointments({ status: 'booked', tenantId: defaultTenantId }).length === 0) {
    return sendCalendar(res, defaultTenantId);
  }
  return res.status(404).send('Not found');
});

module.exports = router;
module.exports.getCalendarToken = getCalendarToken;
