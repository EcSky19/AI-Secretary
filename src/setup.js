'use strict';

const express = require('express');
const db = require('./db');
const runtimeConfig = require('./runtime-config');
const passwordReset = require('./password-reset');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const recoveryPhone = body.recoveryPhone === undefined ? undefined : String(body.recoveryPhone || '').trim();
  if (recoveryPhone) {
    if (!PHONE_RE.test(recoveryPhone)) {
      return res.status(400).json({ error: 'recoveryPhone must be a valid phone number.' });
    }
  }

  const recoveryEmail = body.recoveryEmail === undefined ? undefined : String(body.recoveryEmail || '').trim();
  if (recoveryEmail) {
    if (!EMAIL_RE.test(recoveryEmail)) {
      return res.status(400).json({ error: 'recoveryEmail must be a valid email address.' });
    }
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
  if (recoveryPhone) runtimeConfig.setRecoveryPhone(recoveryPhone);
  if (recoveryEmail) runtimeConfig.setRecoveryEmail(recoveryEmail);

  runtimeConfig.setAdminCredentials({ user: adminUser, password: adminPassword });
  runtimeConfig.markSetupComplete();

  return res.json({ ok: true, authRequired: true, status: runtimeConfig.getSetupStatus() });
});

// --- Forgot password (public, self-service reset) --------------------------

const RESET_MESSAGES = {
  'env-managed':
    'This login is managed by your hosting configuration. Update the ADMIN_PASSWORD environment variable to change it.',
  'not-configured': 'No account password is set yet. Finish first-run setup instead.',
  'no-channel':
    'No recovery contact is set up. Ask whoever set this up to add a recovery phone or email, or use the reset-admin command on the server.',
  'no-recovery-phone':
    'No recovery phone number is on file. Ask whoever set this up to add one, or use the reset-admin command on the server.',
  'sms-unavailable':
    'Text messaging is not connected, so a code cannot be sent. Connect Twilio first, or use the reset-admin command on the server.',
  'no-recovery-email':
    'No recovery email is on file. Ask whoever set this up to add one, or use the reset-admin command on the server.',
  'email-unavailable':
    'Email is not connected, so a code cannot be sent. Set up email (SMTP) first, or use the reset-admin command on the server.',
  'send-failed': 'We could not send the reset code. Check your Twilio/email setup and try again.',
  cooldown: 'A code was just sent. Please wait a moment before requesting another.',
};

function channelInfo(availability) {
  return {
    available: availability.available,
    reason: availability.reason,
    message: availability.available ? '' : RESET_MESSAGES[availability.reason] || '',
  };
}

// Report whether reset is possible and which channels are available.
router.get('/reset-status', (req, res) => {
  const availability = passwordReset.resetAvailability();
  res.json({
    available: availability.available,
    reason: availability.reason,
    message: availability.available ? '' : RESET_MESSAGES[availability.reason] || '',
    channels: {
      sms: channelInfo(availability.channels.sms),
      email: channelInfo(availability.channels.email),
    },
  });
});

// Request a reset code by SMS or email (body: { channel: 'sms' | 'email' }).
router.post('/forgot', express.json(), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const channel = body.channel === 'email' ? 'email' : 'sms';
  try {
    const result = await passwordReset.requestReset(channel);
    if (!result.ok) {
      const status = result.reason === 'cooldown' ? 429 : 400;
      return res.status(status).json({
        ok: false,
        reason: result.reason,
        channel: result.channel,
        retryAfter: result.retryAfter,
        error: RESET_MESSAGES[result.reason] || 'Unable to send a reset code right now.',
      });
    }
    const via = result.channel === 'email' ? 'email' : 'phone';
    return res.json({
      ok: true,
      channel: result.channel,
      maskedTarget: result.maskedTarget,
      maskedPhone: result.maskedPhone,
      message: `We sent a 6-digit code to the ${via} ${result.maskedTarget}.`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Unexpected error sending the reset code.' });
  }
});

// Verify a code and set a new password.
router.post('/reset', express.json(), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const result = await passwordReset.verifyAndReset(body.code, body.newPassword);
    if (!result.ok) {
      const messages = {
        'env-managed': RESET_MESSAGES['env-managed'],
        'invalid-code':
          result.attemptsLeft !== undefined
            ? `That code is incorrect. ${result.attemptsLeft} attempt(s) left.`
            : 'Enter the 6-digit code we sent you.',
        'weak-password': 'Your new password must be at least 6 characters.',
        'no-code': 'Request a code first, then enter it here.',
        expired: 'That code has expired. Request a new one.',
        'too-many-attempts': 'Too many incorrect attempts. Request a new code.',
      };
      return res.status(400).json({
        ok: false,
        reason: result.reason,
        error: messages[result.reason] || 'Could not reset the password.',
      });
    }
    return res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Unexpected error resetting the password.' });
  }
});

module.exports = router;
