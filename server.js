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

// Rate-limit public, unauthenticated routes to blunt abuse.
const publicLimiter = rateLimit();

// Public onboarding endpoints (before auth so a fresh install can be set up).
// Parse their JSON bodies tolerantly (regardless of Content-Type) and BEFORE
// the urlencoded parser below, so a misconfigured or cached client can never
// have onboarding fields silently dropped by form-parsing.
app.use('/api/setup', publicLimiter, express.json({ type: () => true }), require('./src/setup'));

app.use(express.urlencoded({ extended: false })); // Twilio posts urlencoded

// iCal feed (served before static/auth so calendar clients can subscribe).
app.use('/calendar.ics', require('./src/ical-route'));

// Static web UI
app.use(express.static(path.join(__dirname, 'public')));

// Routers (built by sub-agents)
app.use('/api', adminAuth, require('./src/api'));
app.use('/voice', publicLimiter, verifyTwilio, require('./src/voice'));

app.get('/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  let shuttingDown = false;
  const server = app.listen(config.port, () => {
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

  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    // eslint-disable-next-line no-console
    console.log(`Received ${signal}; shutting down gracefully`);

    const forceExitTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      reminders.stopReminders();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to stop reminders:', err);
    }

    try {
      backups.stopBackups();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to stop backups:', err);
    }

    server.close(() => {
      try {
        require('./src/db').db.close();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to close database:', err);
      }

      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
