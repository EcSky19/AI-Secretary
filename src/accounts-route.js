'use strict';

const express = require('express');
const runtimeConfig = require('./runtime-config');
const {
  clearSession,
  createLoginSession,
  login,
  parseCookies,
  signup,
} = require('./auth');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function body(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function sessionResponse(user, tenant) {
  return {
    ok: true,
    user,
    tenant,
    setup: runtimeConfig.getSetupStatus(tenant.id),
  };
}

router.post('/signup', asyncHandler((req, res) => {
  const result = signup(body(req));
  createLoginSession(res, result.user);
  res.status(201).json(sessionResponse(result.user, result.tenant));
}));

router.post('/login', asyncHandler((req, res) => {
  const result = login(body(req));
  createLoginSession(res, result.user);
  res.json(sessionResponse(result.user, result.tenant));
}));

router.post('/logout', asyncHandler((req, res) => {
  const sid = parseCookies(req.headers.cookie || '').sid || '';
  clearSession(res, sid);
  res.json({ ok: true });
}));

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const statuses = {
    INVALID_EMAIL: 400,
    PASSWORD_TOO_SHORT: 400,
    EMAIL_ALREADY_EXISTS: 409,
    INVALID_LOGIN: 401,
    TENANT_INACTIVE: 403,
    VALID_USER_REQUIRED: 400,
  };
  const status = statuses[err && err.code] || 500;
  const message = status >= 500 ? 'Internal server error.' : err.message;
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: message });
});

module.exports = router;
