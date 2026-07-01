'use strict';

const config = require('./config');

// ---------------------------------------------------------------------------
// Security hardening for public deployments.
//
// - securityHeaders: conservative response headers (no new dependency).
// - rateLimit: a small in-memory sliding-window limiter for public,
//   unauthenticated routes (setup + Twilio voice webhooks) to blunt abuse.
//   Not a substitute for a real WAF, but a sensible default for a single-box
//   deployment. Disabled in tests via RATE_LIMIT_ENABLED=false.
// ---------------------------------------------------------------------------

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-DNS-Prefetch-Control', 'off');
  // Only advertise HSTS when the request arrived over HTTPS (behind a proxy the
  // forwarded proto header reflects the real scheme).
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (proto === 'https') {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

// Create a rate-limiting middleware. Keyed by client IP. Uses a fixed window.
function rateLimit(options = {}) {
  const windowMs = options.windowMs || config.security.rateLimitWindowMs;
  const max = options.max || config.security.rateLimitMax;
  const enabled = options.enabled !== undefined ? options.enabled : config.security.rateLimitEnabled;

  const hits = new Map(); // ip -> { count, resetAt }

  // Opportunistically clear expired entries so the map can't grow unbounded.
  function sweep(now) {
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }

  return function rateLimiter(req, res, next) {
    if (!enabled) return next();
    const now = Date.now();
    if (hits.size > 5000) sweep(now);

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    return next();
  };
}

module.exports = { securityHeaders, rateLimit };
