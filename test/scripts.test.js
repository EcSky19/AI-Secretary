'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = path.join(
  __dirname,
  `.secretary-scripts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

test('package exposes phone number helper scripts', () => {
  const root = path.join(__dirname, '..');
  const pkg = require('../package.json');

  assert.equal(pkg.scripts['register-number'], 'node scripts/register-number.js');
  assert.equal(pkg.scripts.config, 'node scripts/print-config.js');
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'register-number.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'print-config.js')), true);
});
