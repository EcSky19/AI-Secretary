'use strict';

const express = require('express');
const db = require('./db');
const runtimeConfig = require('./runtime-config');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Public onboarding endpoints. Mounted BEFORE admin auth so a brand-new,
// unconfigured install can be set up from the browser. Once an admin password
// exists, the profile endpoint refuses further changes (use the authenticated
// settings/config endpoints instead).

router.get('/status', (req, res) => {
  res.json(runtimeConfig.getSetupStatus());
});

router.post('/profile', express.json(), (req, res) => {
  if (runtimeConfig.isAuthConfigured()) {
    return res.status(409).json({
      error: 'Setup is already complete. Sign in to change these settings.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const businessName = String(body.businessName || '').trim();
  if (!businessName) return res.status(400).json({ error: 'businessName is required.' });

  const adminUser = String(body.adminUser || 'admin').trim() || 'admin';
  const adminPassword = String(body.adminPassword || '');
  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'adminPassword must be at least 6 characters.' });
  }

  const start = body.businessHoursStart;
  const end = body.businessHoursEnd;
  if (start !== undefined && !TIME_RE.test(String(start))) {
    return res.status(400).json({ error: 'businessHoursStart must be HH:mm.' });
  }
  if (end !== undefined && !TIME_RE.test(String(end))) {
    return res.status(400).json({ error: 'businessHoursEnd must be HH:mm.' });
  }

  let lengthMinutes;
  if (body.appointmentLengthMinutes !== undefined) {
    lengthMinutes = Number(body.appointmentLengthMinutes);
    if (!Number.isInteger(lengthMinutes) || lengthMinutes <= 0) {
      return res.status(400).json({ error: 'appointmentLengthMinutes must be a positive integer.' });
    }
  }

  runtimeConfig.setBusinessName(businessName);
  if (start !== undefined) db.setSetting('business_hours_start', start);
  if (end !== undefined) db.setSetting('business_hours_end', end);
  if (lengthMinutes !== undefined) db.setSetting('appointment_length_minutes', String(lengthMinutes));

  runtimeConfig.setAdminCredentials({ user: adminUser, password: adminPassword });
  runtimeConfig.markSetupComplete();

  return res.json({ ok: true, authRequired: true, status: runtimeConfig.getSetupStatus() });
});

module.exports = router;
