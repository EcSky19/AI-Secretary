'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  __dirname,
  `.secretary-messages-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;

const db = require('../src/db');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  db.db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('message helpers create, list, count, update, and delete inbox messages', () => {
  const first = db.addMessage({
    callerName: 'Ada Lovelace',
    phone: '+15551230001',
    body: 'Please call me back.',
  });
  const second = db.addMessage({
    callerName: 'Grace Hopper',
    phone: '+15551230002',
    body: 'I need to move my appointment.',
  });

  assert.ok(first.id);
  assert.equal(first.caller_name, 'Ada Lovelace');
  assert.equal(first.phone, '+15551230001');
  assert.equal(first.body, 'Please call me back.');
  assert.equal(first.status, 'new');
  assert.ok(first.created_at);
  assert.equal(db.countNewMessages(), 2);
  assert.deepEqual(db.getMessage(first.id), first);

  const all = db.listMessages({ status: 'all' });
  assert.deepEqual(
    all.map((message) => message.id).sort((a, b) => a - b),
    [first.id, second.id]
  );
  assert.deepEqual(
    db.listMessages({ status: 'new' }).map((message) => message.id).sort((a, b) => a - b),
    [first.id, second.id]
  );
  assert.deepEqual(db.listMessages({ status: 'read' }), []);

  assert.equal(db.setMessageStatus(first.id, 'read'), true);
  assert.equal(db.getMessage(first.id).status, 'read');
  assert.equal(db.countNewMessages(), 1);
  assert.deepEqual(db.listMessages({ status: 'read' }).map((message) => message.id), [first.id]);
  assert.deepEqual(db.listMessages({ status: 'new' }).map((message) => message.id), [second.id]);

  assert.equal(db.deleteMessage(first.id), true);
  assert.equal(db.getMessage(first.id), undefined);
  assert.equal(db.deleteMessage(999999), false);
  assert.deepEqual(db.listMessages({ status: 'all' }).map((message) => message.id), [second.id]);
});
