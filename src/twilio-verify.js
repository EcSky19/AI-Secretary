'use strict';

const config = require('./config');
const runtimeConfig = require('./runtime-config');

// Whether Twilio request-signature validation should run. Requires an auth
// token (from env or runtime config) and the feature flag (on by default,
// disabled in tests via TWILIO_VALIDATE_SIGNATURE=false).
function getAuthToken() {
  return runtimeConfig.getTwilioCredentials().authToken;
}

function isVerifyEnabled() {
  return Boolean(getAuthToken() && config.twilio.validateSignature);
}

// Reconstruct the absolute URL Twilio used to reach us. Honours the configured
// public base URL and proxy headers so signatures match behind tunnels.
function buildRequestUrl(req) {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  if (base) return base + req.originalUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.originalUrl}`;
}

// Express middleware validating the X-Twilio-Signature header on incoming voice
// webhooks. Skips validation (open) when not configured so local/dev works.
function verifyTwilio(req, res, next) {
  if (!isVerifyEnabled()) return next();

  let validateRequest;
  try {
    // eslint-disable-next-line global-require
    ({ validateRequest } = require('twilio'));
  } catch {
    // Twilio SDK unavailable — fail open rather than blocking calls.
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  const url = buildRequestUrl(req);
  const params = req.body && typeof req.body === 'object' ? req.body : {};

  if (signature && validateRequest(getAuthToken(), signature, url, params)) {
    return next();
  }

  res.status(403).type('text/plain').send('Invalid Twilio signature');
}

module.exports = { verifyTwilio, isVerifyEnabled };
