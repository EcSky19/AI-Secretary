'use strict';

const path = require('path');
const express = require('express');
const config = require('./src/config');
const { adminAuth } = require('./src/auth');
const { verifyTwilio } = require('./src/twilio-verify');
const reminders = require('./src/reminders');
const backups = require('./src/backups');
const { securityHeaders, rateLimit } = require('./src/security');
const { getVoiceWebhookUrl } = require('./src/twilio-numbers');

const app = express();

app.set('trust proxy', true);
app.use(securityHeaders);
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts urlencoded

// Rate-limit public, unauthenticated routes to blunt abuse.
const publicLimiter = rateLimit();

// Public onboarding endpoints (before auth so a fresh install can be set up).
app.use('/api/setup', publicLimiter, require('./src/setup'));

// iCal feed (served before static/auth so calendar clients can subscribe).
app.use('/calendar.ics', require('./src/ical-route'));

// Static web UI
app.use(express.static(path.join(__dirname, 'public')));

// Routers (built by sub-agents)
app.use('/api', adminAuth, require('./src/api'));
app.use('/voice', publicLimiter, verifyTwilio, require('./src/voice'));

app.get('/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`AI Secretary running on ${config.publicBaseUrl} (port ${config.port})`);
    try {
      // eslint-disable-next-line no-console
      console.log(`Twilio Voice webhook URL: ${getVoiceWebhookUrl()}`);
    } catch {
      /* twilio-numbers may be unconfigured */
    }
    reminders.startReminders();
    backups.startBackups();
  });
}

module.exports = app;
