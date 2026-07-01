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
};

module.exports = config;
