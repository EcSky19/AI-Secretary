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

// Gather live context so the model can resolve relative references such as
// "tomorrow", "next Tuesday", or "the same time as last week". Falls back to
// bare essentials if the database/settings are unavailable.
function buildContext(extra = {}) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const base = {
    today,
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    currentTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
  };
  try {
    // eslint-disable-next-line global-require
    const runtime = require('./runtime-config');
    if (runtime.getBusinessName) base.businessName = runtime.getBusinessName();
  } catch (_err) {
    /* optional */
  }
  try {
    // eslint-disable-next-line global-require
    const db = require('./db');
    const settings = db.getSettings ? db.getSettings() : null;
    if (settings) {
      base.businessHours = { start: settings.businessHoursStart, end: settings.businessHoursEnd };
      base.appointmentLengthMinutes = settings.appointmentLengthMinutes;
    }
  } catch (_err) {
    /* optional */
  }
  if (extra && typeof extra === 'object') {
    const { flow, name, requestedDate, requestedTime } = extra;
    if (flow) base.conversationFlow = flow;
    if (name) base.callerName = name;
    if (requestedDate) base.requestedDate = requestedDate;
    if (requestedTime) base.requestedTime = requestedTime;
  }
  return base;
}

function getOpenAiSettings() {
  try {
    // eslint-disable-next-line global-require
    return require('./runtime-config').getOpenAiConfig();
  } catch (_err) {
    return { apiKey: config.openai.apiKey, model: config.openai.model };
  }
}

async function parseWithOpenAI(speechText, context = {}) {
  const { apiKey, model } = getOpenAiSettings();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are the phone receptionist for a local trade business (e.g. a plumber or mechanic).',
            'Classify the caller utterance and extract scheduling details.',
            'Return strict JSON only with keys: intent, date, time, name.',
            'intent must be exactly one of: book, cancel, check-availability, reschedule, speak-to-human, leave-message, unknown.',
            'Resolve relative dates ("today", "tomorrow", "next Monday", "this Friday") against context.today (a YYYY-MM-DD date) and context.weekday.',
            'date must be an absolute calendar date in YYYY-MM-DD format, or null if the caller did not specify one.',
            'time must be 24-hour HH:mm, or null. Interpret "afternoon" as 14:00, "morning" as 09:00, and "evening" as 17:00 only when a booking is requested without an exact time.',
            "name is the caller's full name if they state it, else null.",
            'Never invent details the caller did not provide; use null for anything unknown.',
          ].join(' '),
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

  const { apiKey } = getOpenAiSettings();
  if (!apiKey) return fallback;

  try {
    const ai = await parseWithOpenAI(speechText, buildContext(context));
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
