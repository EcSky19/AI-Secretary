'use strict';

const config = require('./config');

// True when any admin credential is configured. When nothing is set the API
// stays open, which keeps local development and the existing tests frictionless.
function isAuthEnabled() {
  return Boolean(config.admin.password || config.admin.token);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    // eslint-disable-next-line global-require
    return require('crypto').timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function checkBasic(header) {
  const m = /^Basic\s+(.+)$/i.exec(header || '');
  if (!m) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return timingSafeEqual(user, config.admin.user) && timingSafeEqual(pass, config.admin.password);
}

function checkBearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m || !config.admin.token) return false;
  return timingSafeEqual(m[1].trim(), config.admin.token);
}

// Express middleware protecting admin routes. Accepts HTTP Basic (user +
// password) or Bearer token (also accepted via ?token= for convenience in
// links). Pass-through when auth is not configured.
function adminAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization || '';
  const queryToken = req.query && req.query.token;

  if (config.admin.password && checkBasic(header)) return next();
  if (config.admin.token && (checkBearer(header) || timingSafeEqual(queryToken, config.admin.token))) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="AI Secretary", charset="UTF-8"');
  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = { adminAuth, isAuthEnabled };
