'use strict';

const crypto = require('crypto');
const config = require('./config');
const runtimeConfig = require('./runtime-config');
const db = require('./db');

const SESSION_COOKIE = 'sid';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isAuthEnabled() {
  return runtimeConfig.isAuthConfigured();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function getSessionId(req) {
  return parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || '';
}

function isSecureRequest(req) {
  return Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function buildSessionCookie(value, req, options = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (isSecureRequest(req || {})) parts.push('Secure');
  return parts.join('; ');
}

function attachTenantFromRows(req, user, tenant) {
  req.user = user || null;
  req.tenant = tenant || null;
  req.tenantId = tenant ? tenant.id : db.resolveDefaultTenantId();
}

function attachDefaultTenant(req) {
  const tenantId = db.resolveDefaultTenantId();
  attachTenantFromRows(req, null, db.getTenantById(tenantId));
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
  return runtimeConfig.verifyAdminLogin(user, pass);
}

function checkBearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m || !config.admin.token) return false;
  return timingSafeEqual(m[1].trim(), config.admin.token);
}

function checkPlatformAuth(req) {
  const header = req.headers.authorization || '';
  const queryToken = req.query && req.query.token;
  if (checkBasic(header)) return true;
  return Boolean(config.admin.token && (checkBearer(header) || timingSafeEqual(queryToken, config.admin.token)));
}

function attachTenant(req, res, next) {
  const sid = getSessionId(req);
  if (sid) {
    const session = db.getSession(sid);
    if (session) {
      const user = db.getUserById(session.user_id);
      const tenant = db.getTenantById(session.tenant_id);
      if (user && tenant) {
        attachTenantFromRows(req, user, tenant);
        return next();
      }
    }
  }

  if (checkPlatformAuth(req)) {
    attachDefaultTenant(req);
    return next();
  }

  attachDefaultTenant(req);
  return next();
}

function adminAuth(req, res, next) {
  attachTenant(req, res, () => {
    if (req.user) return next();
    if (!isAuthEnabled()) return next();
    if (checkPlatformAuth(req)) return next();

    res.set('WWW-Authenticate', 'Basic realm="AI Secretary", charset="UTF-8"');
    return res.status(401).json({ error: 'Authentication required' });
  });
}

function createLoginSession(res, user, ttlMs = DEFAULT_SESSION_TTL_MS) {
  if (!user || !user.id || !user.tenant_id) throw new Error('VALID_USER_REQUIRED');
  const session = db.createSession(user.id, user.tenant_id, ttlMs);
  res.setHeader('Set-Cookie', buildSessionCookie(session.id, res.req, {
    maxAge: ttlMs,
    expires: new Date(Date.parse(session.expires_at)),
  }));
  return session;
}

function clearSession(res, sid) {
  if (sid) db.deleteSession(sid);
  res.setHeader('Set-Cookie', buildSessionCookie('', res.req, {
    maxAge: 0,
    expires: new Date(0),
  }));
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _passwordHash, ...rest } = user;
  return rest;
}

function validateEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error('INVALID_EMAIL');
    err.code = 'INVALID_EMAIL';
    throw err;
  }
  return normalized;
}

function validatePassword(password) {
  if (String(password || '').length < 6) {
    const err = new Error('PASSWORD_TOO_SHORT');
    err.code = 'PASSWORD_TOO_SHORT';
    throw err;
  }
}

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'tenant';
}

function uniqueSlug(base) {
  let slug = base;
  let i = 2;
  while (db.getTenantBySlug(slug)) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}

function signup({ email, password, businessName } = {}) {
  const normalizedEmail = validateEmail(email);
  validatePassword(password);
  if (db.getUserByEmail(normalizedEmail)) {
    const err = new Error('EMAIL_ALREADY_EXISTS');
    err.code = 'EMAIL_ALREADY_EXISTS';
    throw err;
  }

  const name = String(businessName || '').trim() || normalizedEmail.split('@')[0];
  const tenant = db.createTenant({
    slug: uniqueSlug(slugify(name)),
    businessName: name,
  });
  db.setSetting(tenant.id, 'business_name', name);
  const user = db.createUser({
    tenantId: tenant.id,
    email: normalizedEmail,
    passwordHash: runtimeConfig.hashPassword(password),
    role: 'owner',
  });
  return { user: sanitizeUser(user), tenant };
}

function login({ email, password } = {}) {
  const normalizedEmail = validateEmail(email);
  const user = db.getUserByEmail(normalizedEmail);
  if (!user || !runtimeConfig.verifyPasswordHash(password, user.password_hash)) {
    const err = new Error('INVALID_LOGIN');
    err.code = 'INVALID_LOGIN';
    throw err;
  }
  const tenant = db.getTenantById(user.tenant_id);
  if (!tenant || tenant.status !== 'active') {
    const err = new Error('TENANT_INACTIVE');
    err.code = 'TENANT_INACTIVE';
    throw err;
  }
  return { user: sanitizeUser(user), tenant };
}

module.exports = {
  attachTenant,
  adminAuth,
  isAuthEnabled,
  createLoginSession,
  clearSession,
  signup,
  login,
  parseCookies,
};
