'use strict';

require('dotenv').config();

const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  // Public URL for Twilio webhooks. Auto-detected on common hosts (Render sets
  // RENDER_EXTERNAL_URL) so non-technical deployments work without config.
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    `http://localhost:${process.env.PORT || 3000}`,
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'secretary.db'),
  timezone: process.env.TIMEZONE || 'America/Los_Angeles',

  defaults: {
    businessHoursStart: process.env.BUSINESS_HOURS_START || '09:00',
    businessHoursEnd: process.env.BUSINESS_HOURS_END || '17:00',
    appointmentLengthMinutes: parseInt(process.env.APPOINTMENT_LENGTH_MINUTES, 10) || 30,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    // Validate incoming Twilio webhook signatures when an auth token is set.
    // Disable explicitly with TWILIO_VALIDATE_SIGNATURE=false (e.g. for tests).
    validateSignature: process.env.TWILIO_VALIDATE_SIGNATURE !== 'false',
  },

  // Optional admin protection for the API and dashboard. When neither a
  // password nor a token is set, the API is open (convenient for local use).
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    token: process.env.ADMIN_TOKEN || '',
  },

  // Automatic SMS appointment reminders.
  reminders: {
    enabled: process.env.REMINDERS_ENABLED !== 'false',
    leadMinutes: parseInt(process.env.REMINDER_LEAD_MINUTES, 10) || 60,
    pollSeconds: parseInt(process.env.REMINDER_POLL_SECONDS, 10) || 60,
  },

  // Automatic database backups (protects the SQLite appointment data).
  backups: {
    enabled: process.env.BACKUPS_ENABLED !== 'false',
    intervalHours: parseFloat(process.env.BACKUP_INTERVAL_HOURS) || 24,
    keep: parseInt(process.env.BACKUP_KEEP, 10) || 14,
    dir: process.env.BACKUP_DIR || '',
  },

  // Security hardening for public deployments.
  security: {
    // Rate limiting on public, unauthenticated routes (setup + voice webhooks).
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 120,
  },

  // Optional outbound email (SMTP) for password reset by email. Owners can also
  // configure this from the dashboard; environment variables take precedence.
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 0,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || '',
  },
};

module.exports = config;
