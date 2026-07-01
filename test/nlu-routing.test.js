'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const testDbPath = path.join(
  os.tmpdir(),
  `ai-ssml-nlu-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_MODEL = '';

const realFetch = global.fetch;
const runtimeConfig = require('../src/runtime-config');
const { parseIntent } = require('../src/nlu');

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

after(() => {
  global.fetch = realFetch;
  require('../src/db').db.close();
  removeIfExists(testDbPath);
  removeIfExists(`${testDbPath}-wal`);
  removeIfExists(`${testDbPath}-shm`);
});

test('parseIntent falls back to rule-based routing when no OpenAI key is configured', async () => {
  runtimeConfig.setOpenAiConfig({ apiKey: '' });

  assert.equal((await parseIntent('I want to cancel my appointment')).intent, 'cancel');
  assert.equal((await parseIntent('what times are available')).intent, 'check-availability');
  assert.equal((await parseIntent('I need to book an appointment')).intent, 'book');
});

test('parseIntent uses a stubbed OpenAI response when a key is configured', async () => {
  runtimeConfig.setOpenAiConfig({ apiKey: 'sk-test1234567890abcdef' });
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: 'reschedule',
              date: '2099-01-02',
              time: '15:30',
              name: 'Jane Doe',
            }),
          },
        },
      ],
    }),
  });

  const result = await parseIntent('move my appointment please');

  assert.equal(result.intent, 'reschedule');
  assert.equal(result.date, '2099-01-02');
  assert.equal(result.time, '15:30');
  assert.equal(result.name, 'Jane Doe');
});

test('parseIntent falls back gracefully when OpenAI fetch fails', async () => {
  runtimeConfig.setOpenAiConfig({ apiKey: 'sk-test1234567890abcdef' });
  global.fetch = async () => {
    throw new Error('network unavailable');
  };

  const result = await parseIntent('I want to cancel my appointment');

  assert.equal(result.intent, 'cancel');
});

test('parseIntent falls back gracefully when OpenAI returns a non-ok response', async () => {
  runtimeConfig.setOpenAiConfig({ apiKey: 'sk-test1234567890abcdef' });
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  const result = await parseIntent('what times are available');

  assert.equal(result.intent, 'check-availability');
});
