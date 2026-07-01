'use strict';

const config = require('./config');
const { parseDateTime } = require('./datetime-parse');

const INTENTS = new Set([
  'book',
  'cancel',
  'check-availability',
  'reschedule',
  'speak-to-human',
  'leave-message',
  'unknown',
]);

function normalizeIntent(intent) {
  const value = String(intent || '').toLowerCase().replace(/_/g, '-');
  if (['schedule', 'make-appointment', 'appointment', 'reserve'].includes(value)) return 'book';
  if (['availability', 'available', 'check'].includes(value)) return 'check-availability';
  if (['move-appointment', 'change-appointment', 'change-time', 'different-time'].includes(value)) return 'reschedule';
  if (['human', 'operator', 'representative', 'staff'].includes(value)) return 'speak-to-human';
  if (['message', 'take-message', 'leave-a-message'].includes(value)) return 'leave-message';
  return INTENTS.has(value) ? value : 'unknown';
}

function extractName(text) {
  const s = String(text || '').trim();
  const match = s.match(/\b(?:my name is|this is|i am|i'm|name is)\s+([a-z ,.'-]{2,60})/i);
  if (!match) return null;
  return match[1]
    .replace(/\b(for|to|at|on|tomorrow|today)\b.*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function ruleBasedParse(speechText) {
  const text = String(speechText || '');
  const lower = text.toLowerCase();
  let intent = 'unknown';

  if (/\b(cancel|delete|remove|call off)\b/.test(lower)) intent = 'cancel';
  else if (
    /\b(reschedule|move|change|push)\b.*\b(appointment|meeting|slot|time)?\b/.test(lower) ||
    /\b(different|another|new)\s+time\b/.test(lower)
  ) {
    intent = 'reschedule';
  } else if (/\b(leave|take)\s+(?:a\s+)?message\b/.test(lower)) {
    intent = 'leave-message';
  }
  else if (/\b(available|availability|open|free|what times|when can|slots?)\b/.test(lower)) {
    intent = 'check-availability';
  } else if (/\b(book|schedule|make|set up|reserve)\b.*\b(appointment|meeting|slot)?\b/.test(lower)) {
    intent = 'book';
  } else if (/\b(human|person|operator|representative|staff|front desk)\b/.test(lower)) {
    intent = 'speak-to-human';
  }

  const parsed = parseDateTime(text);
  return {
    intent,
    date: parsed.date,
    time: parsed.time,
    name: extractName(text),
    raw: text,
  };
}

async function parseWithOpenAI(speechText, context = {}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return strict JSON only with keys intent, date, time, name. intent must be one of book, cancel, check-availability, reschedule, speak-to-human, leave-message, unknown. Dates use YYYY-MM-DD and times use HH:mm when explicitly inferable from the caller. Use null for missing fields.',
        },
        {
          role: 'user',
          content: JSON.stringify({ speechText, context }),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI NLU failed with ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

async function parseIntent(speechText, context = {}) {
  const fallback = ruleBasedParse(speechText);

  if (!config.openai.apiKey) return fallback;

  try {
    const ai = await parseWithOpenAI(speechText, context);
    const localDateTime = parseDateTime(speechText);
    return {
      intent: normalizeIntent(ai.intent) || fallback.intent,
      date: ai.date || localDateTime.date || fallback.date,
      time: ai.time || localDateTime.time || fallback.time,
      name: ai.name || fallback.name,
      raw: speechText,
    };
  } catch (_err) {
    return fallback;
  }
}

module.exports = {
  parseIntent,
  ruleBasedParse,
};
