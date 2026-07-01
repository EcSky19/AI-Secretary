'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { securityHeaders, rateLimit } = require('../src/security');

let server;
let baseUrl;

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, () => {
      resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
    });
  });
}

function close(s) {
  return new Promise((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
}

before(async () => {
  const app = express();
  app.use(securityHeaders);
  app.get('/headers', (req, res) => res.json({ ok: true }));
  app.use('/limited', rateLimit({ max: 3, windowMs: 60000, enabled: true }));
  app.get('/limited', (req, res) => res.json({ ok: true }));
  app.use('/disabled', rateLimit({ max: 1, windowMs: 60000, enabled: false }));
  app.get('/disabled', (req, res) => res.json({ ok: true }));
  ({ server, baseUrl } = await listen(app));
});

after(async () => {
  await close(server);
});

test('securityHeaders sets conservative response headers', async () => {
  const res = await fetch(`${baseUrl}/headers`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('rateLimit allows requests through the limit then returns JSON 429 metadata', async () => {
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${baseUrl}/limited`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-ratelimit-limit'), '3');
    assert.equal(res.headers.get('x-ratelimit-remaining'), String(2 - i));
  }

  const blocked = await fetch(`${baseUrl}/limited`);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal(blocked.headers.get('x-ratelimit-remaining'), '0');
  const body = await blocked.json();
  assert.match(body.error, /Too many requests/);
});

test('rateLimit with enabled false never blocks', async () => {
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${baseUrl}/disabled`);
    assert.equal(res.status, 200);
  }
});
