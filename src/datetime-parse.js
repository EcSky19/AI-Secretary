'use strict';

const scheduling = require('./scheduling');

const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

// Spoken ordinals for days of the month, e.g. "seventh" -> 7, "twenty first" -> 21.
const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, 'twenty first': 21, 'twenty second': 22,
  'twenty third': 23, 'twenty fourth': 24, 'twenty fifth': 25, 'twenty sixth': 26,
  'twenty seventh': 27, 'twenty eighth': 28, 'twenty ninth': 29, thirtieth: 30,
  'thirty first': 31,
};

// Entries sorted so multi-word phrases are replaced before their single-word
// components (e.g. "twenty first" before "first").
const ORDINAL_ENTRIES = Object.entries(ORDINAL_WORDS).sort(
  (a, b) => b[0].length - a[0].length
);

// Replace spoken ordinal words with digits so date regexes can match them.
function normalizeOrdinals(s) {
  let out = s;
  for (const [word, num] of ORDINAL_ENTRIES) {
    out = out.replace(new RegExp(`\\b${word.replace(/ /g, '[\\s-]+')}\\b`, 'g'), String(num));
  }
  // Strip ordinal suffixes on digits, e.g. "7th" -> "7", "21st" -> "21".
  out = out.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1');
  return out;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateToStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayDate() {
  const [y, m, d] = scheduling.todayDateStr().split('-').map(Number);
  return new Date(y, m - 1, d);
}

function clean(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(text) {
  const s = normalizeOrdinals(clean(text));
  const base = todayDate();

  if (/\btoday\b/.test(s)) return dateToStr(base);
  if (/\btomorrow\b/.test(s)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return dateToStr(d);
  }

  const monthMatch = s.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  if (monthMatch) {
    const month = MONTHS[monthMatch[1]];
    const day = Number(monthMatch[2]);
    let d = new Date(base.getFullYear(), month, day);
    if (d < base) d = new Date(base.getFullYear() + 1, month, day);
    return dateToStr(d);
  }

  const numericMatch = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericMatch) {
    const month = Number(numericMatch[1]) - 1;
    const day = Number(numericMatch[2]);
    let year = numericMatch[3] ? Number(numericMatch[3]) : base.getFullYear();
    if (year < 100) year += 2000;
    let d = new Date(year, month, day);
    if (!numericMatch[3] && d < base) d = new Date(base.getFullYear() + 1, month, day);
    return dateToStr(d);
  }

  const weekdayMatch = s.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[2]];
    const isNext = Boolean(weekdayMatch[1]);
    let diff = (target - base.getDay() + 7) % 7;
    if (isNext || diff === 0) diff += 7;
    const d = new Date(base);
    d.setDate(d.getDate() + diff);
    return dateToStr(d);
  }

  // Bare day-of-month, e.g. "on the 7th" -> 7th of this month (or next month if past).
  const dayMatch = s.match(/\bthe\s+(\d{1,2})\b/) || s.match(/\bon\s+(\d{1,2})\b/);
  if (dayMatch) {
    const day = Number(dayMatch[1]);
    if (day >= 1 && day <= 31) {
      let d = new Date(base.getFullYear(), base.getMonth(), day);
      if (d < base) d = new Date(base.getFullYear(), base.getMonth() + 1, day);
      return dateToStr(d);
    }
  }

  return null;
}

function parseTime(text) {
  const s = clean(text);
  if (/\b(noon|midday)\b/.test(s)) return '12:00';
  if (/\b(morning)\b/.test(s)) return '09:00';
  if (/\b(afternoon)\b/.test(s)) return '13:00';
  if (/\b(evening)\b/.test(s)) return '16:00';

  let match = s.match(/\b(?:at|around|about|for)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\s*m|p\s*m|am|pm)\b/);
  if (!match) match = s.match(/\b(\d{1,2}):(\d{2})\b/);
  // Bare hour with an explicit preposition, e.g. "at 2" -> 2 (pm heuristic below).
  if (!match) match = s.match(/\b(?:at|around|about)\s+(\d{1,2})\b(?!\s*:)/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = (match[3] || '').replace(/\s/g, '');
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    if (hour <= 23 && minute <= 59) return `${pad2(hour)}:${pad2(minute)}`;
  }

  const wordMatch = s.match(
    /\b(?:at|around|about|for)?\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(thirty|fifteen|forty five))?\s*(a\s*m|p\s*m|am|pm)?\b/
  );
  if (wordMatch) {
    let hour = NUMBER_WORDS[wordMatch[1]];
    const minuteWords = { thirty: 30, fifteen: 15, 'forty five': 45 };
    const minute = minuteWords[wordMatch[2]] || 0;
    const meridiem = (wordMatch[3] || '').replace(/\s/g, '');
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  return null;
}

function parseDateTime(text) {
  return {
    date: parseDate(text),
    time: parseTime(text),
  };
}

module.exports = {
  parseDate,
  parseTime,
  parseDateTime,
};
