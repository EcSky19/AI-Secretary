'use strict';

const express = require('express');
const twilio = require('twilio');
const config = require('./config');
const db = require('./db');
const scheduling = require('./scheduling');
const runtimeConfig = require('./runtime-config');
const tenancy = require('./tenancy');
const { parseIntent } = require('./nlu');
const { parseDateTime } = require('./datetime-parse');

const { VoiceResponse } = twilio.twiml;
const router = express.Router();
const calls = new Map();

function callState(callSid, from) {
  if (!calls.has(callSid)) calls.set(callSid, { from, retries: 0, flow: 'idle' });
  const state = calls.get(callSid);
  state.from = from || state.from;
  return state;
}

function defaultTenantContext() {
  const tenantId = tenancy.getDefaultTenantId();
  const cfg = tenancy.getTenantConfig(tenantId);
  return {
    tenant: cfg?.tenant || null,
    tenantId,
    tenantNumber: cfg?.twilioPhoneNumber || runtimeConfig.getTenantFromNumber(tenantId) || '',
    matched: Boolean(cfg?.tenant),
    usedDefault: true,
  };
}

function resolveTenantContext(req, state, { rejectUnmatchedTo = false } = {}) {
  if (state?.tenantId) {
    return {
      tenant: state.tenant || null,
      tenantId: state.tenantId,
      tenantNumber: state.tenantNumber || runtimeConfig.getTenantFromNumber(state.tenantId) || '',
      matched: true,
      usedDefault: false,
    };
  }

  const to = req?.body?.To;
  if (to) {
    const tenant = tenancy.resolveTenantByPhone(to);
    if (tenant) {
      return {
        tenant,
        tenantId: tenant.id,
        tenantNumber: tenant.twilio_phone_number || tenancy.normalizeE164(to),
        matched: true,
        usedDefault: false,
      };
    }
    if (rejectUnmatchedTo) return { tenant: null, tenantId: null, tenantNumber: tenancy.normalizeE164(to), matched: false };
  }

  return defaultTenantContext();
}

function attachTenantState(response, state, context) {
  state.tenantId = context.tenantId;
  state.tenant = context.tenant || state.tenant || null;
  state.tenantNumber = context.tenantNumber || state.tenantNumber || '';
  response.tenantId = state.tenantId;
}

function actionUrl(path) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/, '')}/voice${path}`;
  return `/voice${path}`;
}

function sendTwiml(res, response) {
  res.type('text/xml').send(response.toString());
}

function sayOptions(tenantId) {
  const voice = runtimeConfig.getVoiceName(tenantId);
  return voice ? { voice } : {};
}

// Render a prompt into a <Say> node as SSML for a more natural cadence.
// Sentences are wrapped in <s> (Polly inserts a natural pause between them) and
// an inline "[[pause]]" / "[[pause:600ms]]" token becomes an explicit <break>.
function speak(sayNode, prompt) {
  const raw = prompt == null ? '' : String(prompt);
  if (!raw.trim()) {
    sayNode.addText(' ');
    return sayNode;
  }
  const segments = raw.split(/(\[\[pause(?::\d+m?s)?\]\])/i);
  for (const segment of segments) {
    if (!segment) continue;
    const pause = segment.match(/^\[\[pause(?::(\d+m?s))?\]\]$/i);
    if (pause) {
      sayNode.break({ time: pause[1] || '450ms' });
      continue;
    }
    const sentences = segment.match(/[^.!?]+[.!?]*/g);
    if (!sentences) {
      const text = segment.trim();
      if (text) sayNode.s(text);
      continue;
    }
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (text) sayNode.s(text);
    }
  }
  return sayNode;
}

function gather(response, prompt, action = '/respond') {
  const g = response.gather({
    input: 'speech',
    action: actionUrl(action),
    method: 'POST',
    speechTimeout: 'auto',
    timeout: 6,
  });
  speak(g.say(sayOptions(response.tenantId)), prompt);
  response.redirect({ method: 'POST' }, actionUrl('/reprompt'));
}

function sayAndHangup(response, message) {
  speak(response.say(sayOptions(response.tenantId)), message);
  response.hangup();
}

function hangupUnconfiguredNumber(response) {
  response.tenantId = tenancy.getDefaultTenantId();
  sayAndHangup(response, 'Sorry, this number is not configured yet. Please call again. Goodbye.');
}

function attachRequiredTenantState(response, state, req) {
  const tenantContext = resolveTenantContext(req, state, { rejectUnmatchedTo: true });
  if (!tenantContext.tenantId || tenantContext.usedDefault) {
    hangupUnconfiguredNumber(response);
    return false;
  }
  attachTenantState(response, state, tenantContext);
  return true;
}

function slotSpeech(slot) {
  return scheduling.formatStampForSpeech(slot.startStamp);
}

function slotsPrompt(slots) {
  return slots.map((slot, i) => `Option ${i + 1}: ${slotSpeech(slot)}`).join('. ');
}

function slotFromDateTime(date, time, tenantId) {
  if (!date || !time) return null;
  const length = db.getSettings(tenantId).appointmentLengthMinutes;
  const startStamp = scheduling.makeStamp(date, time);
  const end = scheduling.addMinutesToTime(time, length);
  return {
    date,
    start: time,
    end,
    startStamp,
    endStamp: scheduling.makeStamp(date, end),
    label: scheduling.formatTimeForSpeech(time),
  };
}

function isUsableSlot(slot, excludeId, tenantId) {
  if (!slot) return false;
  return slot.startStamp >= scheduling.nowStamp() && db.isSlotFree(slot.startStamp, slot.endStamp, excludeId, tenantId);
}

function getAvailableSlots(dateStr, tenantId, opts = {}) {
  if (!db.isDateOpen(dateStr, tenantId)) return [];

  const settings = db.getSettings(tenantId);
  const length = opts.lengthMinutes || settings.appointmentLengthMinutes;
  const startMin = scheduling.timeToMinutes(settings.businessHoursStart);
  const endMin = scheduling.timeToMinutes(settings.businessHoursEnd);
  const now = scheduling.nowStamp();
  const slots = [];

  for (let t = startMin; t + length <= endMin; t += length) {
    const startTime = scheduling.minutesToTime(t);
    const endTime = scheduling.minutesToTime(t + length);
    const startStamp = scheduling.makeStamp(dateStr, startTime);
    const endStamp = scheduling.makeStamp(dateStr, endTime);

    if (startStamp < now) continue;
    if (!db.isSlotFree(startStamp, endStamp, null, tenantId)) continue;

    slots.push({
      date: dateStr,
      start: startTime,
      end: endTime,
      startStamp,
      endStamp,
      label: scheduling.formatTimeForSpeech(startTime),
    });
  }
  return slots;
}

function getNextAvailableSlots(fromDateStr, tenantId, count = 3, daysAhead = 21, lengthMinutes) {
  const results = [];
  const [y, mo, d] = fromDateStr.split('-').map(Number);
  const cursor = new Date(y, mo - 1, d);

  for (let i = 0; i < daysAhead && results.length < count; i += 1) {
    const dateStr = `${cursor.getFullYear()}-${scheduling.pad2(cursor.getMonth() + 1)}-${scheduling.pad2(
      cursor.getDate()
    )}`;
    for (const slot of getAvailableSlots(dateStr, tenantId, { lengthMinutes })) {
      results.push(slot);
      if (results.length >= count) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

function nearbySlots(date, tenantId, count = 3) {
  const settings = db.getSettings(tenantId);
  return getNextAvailableSlots(date || scheduling.todayDateStr(), tenantId, count, 21, settings.appointmentLengthMinutes);
}

function nluContext(state) {
  const tenantConfig = tenancy.getTenantConfig(state.tenantId);
  return {
    ...state,
    tenantId: state.tenantId,
    tenantConfig,
    businessName: tenantConfig?.businessName,
    businessHours: tenantConfig
      ? { start: tenantConfig.businessHoursStart, end: tenantConfig.businessHoursEnd }
      : runtimeConfig.getBusinessHours(state.tenantId),
    appointmentLengthMinutes: tenantConfig?.appointmentLengthMinutes,
    openai: runtimeConfig.getOpenAiConfig(state.tenantId),
    aiUnderstandingEnabled: runtimeConfig.isAiUnderstandingEnabled(state.tenantId),
  };
}

function parseTenantIntent(speech, state) {
  return parseIntent(speech, nluContext(state));
}

async function sendTenantSms(tenantId, to, body) {
  const trimmedTo = String(to || '').trim();
  if (!trimmedTo) return { sent: false, reason: 'no-recipient' };

  const { accountSid, authToken } = runtimeConfig.getTwilioCredentials();
  const from = runtimeConfig.getTenantFromNumber(tenantId);
  if (!accountSid || !authToken || !accountSid.startsWith('AC') || !from) {
    console.log(`[voice] (SMS disabled) would text ${trimmedTo}: ${body}`);
    return { sent: false, reason: 'not-configured' };
  }

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({ to: trimmedTo, from, body });
    return { sent: true, sid: message.sid };
  } catch (err) {
    console.error(`[voice] SMS to ${trimmedTo} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}

async function notifyTenantRescheduled(state, appointment, formatStamp) {
  if (!appointment || !appointment.phone) return { sent: false, reason: 'no-phone' };
  const when = formatStamp ? formatStamp(appointment.start_time) : appointment.start_time;
  return sendTenantSms(state.tenantId, appointment.phone, `Your appointment has been moved to ${when}.`);
}

function parseOrdinal(text) {
  const s = String(text || '').toLowerCase();
  const digit = s.match(/\b([1-9])\b/);
  if (digit) return Number(digit[1]) - 1;
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'one', 'two', 'three', 'four', 'five'];
  const found = words.findIndex((word) => new RegExp(`\\b${word}\\b`).test(s));
  return found < 0 ? -1 : found % 5;
}

function isYes(text) {
  return /\b(yes|yeah|yep|correct|confirm|please do|that works|sure)\b/i.test(String(text || ''));
}

function isNo(text) {
  return /\b(no|nope|cancel|stop|not right|wrong)\b/i.test(String(text || ''));
}

function resetForRetry(state) {
  state.retries = (state.retries || 0) + 1;
  return state.retries <= 2;
}

function complete(response, callSid, message) {
  calls.delete(callSid);
  sayAndHangup(response, message);
}

function askForInitial(response) {
  const businessName = runtimeConfig.getBusinessName(response.tenantId);
  const intro =
    businessName && businessName !== 'AI Secretary'
      ? `Thank you for calling ${businessName}. I am the automated assistant.`
      : 'Hello, I am the AI secretary.';
  gather(
    response,
    `${intro} You can book, cancel, or reschedule an appointment, ask what times are available, or leave a message. How can I help?`
  );
}

function askForName(response, state) {
  state.flow = 'awaiting-name';
  gather(response, `I can book ${slotSpeech(state.pendingSlot)}. What name should I put on the appointment?`);
}

function askBookingConfirmation(response, state) {
  state.flow = 'awaiting-book-confirmation';
  gather(
    response,
    `Please confirm: book an appointment for ${state.name} on ${slotSpeech(
      state.pendingSlot
    )}. Say yes to confirm, or no to choose another time.`
  );
}

function offerSlots(response, state, intro, slots) {
  if (!slots.length) {
    gather(response, `${intro} I do not see any openings soon. Please say another day or time.`);
    state.flow = 'awaiting-book-time';
    return;
  }
  state.offeredSlots = slots;
  state.flow = 'awaiting-slot-choice';
  gather(response, `${intro} ${slotsPrompt(slots)}. Which option would you like?`);
}

function handleBook(response, state, parsed) {
  state.intent = 'book';
  state.requestedDate = parsed.date || state.requestedDate;
  state.name = parsed.name || state.name;

  if (!state.requestedDate && !parsed.time) {
    state.flow = 'awaiting-book-time';
    gather(response, 'What day and time would you like for the appointment?');
    return;
  }

  if (state.requestedDate && parsed.time) {
    const slot = slotFromDateTime(state.requestedDate, parsed.time, state.tenantId);
    if (isUsableSlot(slot, null, state.tenantId)) {
      state.pendingSlot = slot;
      if (!state.name) askForName(response, state);
      else askBookingConfirmation(response, state);
      return;
    }
    offerSlots(
      response,
      state,
      'Sorry, that time is not available. Here are the next openings.',
      nearbySlots(state.requestedDate, state.tenantId)
    );
    return;
  }

  const date = state.requestedDate || scheduling.todayDateStr();
  const daySlots = getAvailableSlots(date, state.tenantId, {
    lengthMinutes: db.getSettings(state.tenantId).appointmentLengthMinutes,
  });
  offerSlots(response, state, 'Here are available times.', daySlots.slice(0, 4));
}

function bookPending(response, state, callSid) {
  try {
    const appointment = db.bookAppointment({
      tenantId: state.tenantId,
      name: state.name || 'Caller',
      phone: state.from || '',
      reason: 'Phone appointment',
      startISO: state.pendingSlot.startStamp,
      endISO: state.pendingSlot.endStamp,
    });
    complete(
      response,
      callSid,
      `You are booked for ${scheduling.formatStampForSpeech(
        appointment.start_time
      )}. Thank you for calling. Goodbye.`
    );
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      offerSlots(
        response,
        state,
        'Sorry, that slot was just taken. Here are other openings.',
        nearbySlots(state.pendingSlot.date, state.tenantId)
      );
      return;
    }
    throw err;
  }
}

function handleAvailability(response, state, parsed) {
  const date = parsed.date || scheduling.todayDateStr();
  const slots = getAvailableSlots(date, state.tenantId, {
    lengthMinutes: db.getSettings(state.tenantId).appointmentLengthMinutes,
  });
  const available = slots.length ? slots.slice(0, 4) : nearbySlots(date, state.tenantId, 4);
  if (!available.length) {
    complete(response, state.callSid, 'I do not see available appointments soon. Please call again later. Goodbye.');
    return;
  }
  complete(response, state.callSid, `The next available times are: ${slotsPrompt(available)}. Goodbye.`);
}

function handleCancel(response, state) {
  const appointments = db.findAppointmentsByPhone(state.from || '', { upcomingOnly: true, tenantId: state.tenantId });
  if (!appointments.length) {
    complete(response, state.callSid, 'I do not see any upcoming booked appointments for this phone number. Goodbye.');
    return;
  }
  state.cancelOptions = appointments.slice(0, 5);
  if (state.cancelOptions.length === 1) {
    state.pendingCancelId = state.cancelOptions[0].id;
    state.flow = 'awaiting-cancel-confirmation';
    gather(
      response,
      `I found an appointment on ${scheduling.formatStampForSpeech(
        state.cancelOptions[0].start_time
      )}. Should I cancel it?`
    );
    return;
  }
  state.flow = 'awaiting-cancel-choice';
  const choices = state.cancelOptions
    .map((appt, i) => `Option ${i + 1}: ${scheduling.formatStampForSpeech(appt.start_time)}`)
    .join('. ');
  gather(response, `I found multiple appointments. ${choices}. Which one should I cancel?`);
}

function rescheduleChoicesPrompt(appointments) {
  return appointments
    .map((appt, i) => `Option ${i + 1}: ${scheduling.formatStampForSpeech(appt.start_time)}`)
    .join('. ');
}

function askForRescheduleTime(response, state, appointment) {
  state.rescheduleId = appointment.id;
  state.flow = 'awaiting-reschedule-time';
  gather(
    response,
    `I found your appointment on ${scheduling.formatStampForSpeech(
      appointment.start_time
    )}. What new day and time would you like?`
  );
}

function offerRescheduleSlots(response, state, intro, slots) {
  if (!slots.length) {
    state.flow = 'awaiting-reschedule-time';
    gather(response, `${intro} I do not see any openings soon. Please say another day or time.`);
    return;
  }
  state.offeredSlots = slots;
  state.flow = 'awaiting-reschedule-slot-choice';
  gather(response, `${intro} ${slotsPrompt(slots)}. Which option would you like?`);
}

function askRescheduleConfirmation(response, state) {
  state.flow = 'awaiting-reschedule-confirmation';
  gather(
    response,
    `Please confirm: move your appointment to ${slotSpeech(
      state.pendingRescheduleSlot
    )}. Say yes to confirm, or no to choose another time.`
  );
}

function handleReschedule(response, state) {
  const appointments = db.findAppointmentsByPhone(state.from || '', { upcomingOnly: true, tenantId: state.tenantId });
  if (!appointments.length) {
    complete(response, state.callSid, 'I do not see any upcoming booked appointments for this phone number. Goodbye.');
    return;
  }
  state.rescheduleOptions = appointments.slice(0, 5);
  if (state.rescheduleOptions.length === 1) {
    askForRescheduleTime(response, state, state.rescheduleOptions[0]);
    return;
  }
  state.flow = 'awaiting-reschedule-pick';
  gather(
    response,
    `I found multiple appointments. ${rescheduleChoicesPrompt(
      state.rescheduleOptions
    )}. Which one should I reschedule?`
  );
}

function handleRescheduleTime(response, state, parsed) {
  state.requestedRescheduleDate = parsed.date || state.requestedRescheduleDate;

  if (!state.requestedRescheduleDate && !parsed.time) {
    state.flow = 'awaiting-reschedule-time';
    gather(response, 'What new day and time would you like?');
    return;
  }

  if (state.requestedRescheduleDate && parsed.time) {
    const slot = slotFromDateTime(state.requestedRescheduleDate, parsed.time, state.tenantId);
    if (isUsableSlot(slot, state.rescheduleId, state.tenantId)) {
      state.pendingRescheduleSlot = slot;
      askRescheduleConfirmation(response, state);
      return;
    }
    offerRescheduleSlots(
      response,
      state,
      'Sorry, that time is not available. Here are the next openings.',
      nearbySlots(state.requestedRescheduleDate, state.tenantId)
    );
    return;
  }

  const date = state.requestedRescheduleDate || scheduling.todayDateStr();
  const daySlots = getAvailableSlots(date, state.tenantId, {
    lengthMinutes: db.getSettings(state.tenantId).appointmentLengthMinutes,
  });
  offerRescheduleSlots(response, state, 'Here are available times.', daySlots.slice(0, 4));
}

function reschedulePending(response, state, callSid) {
  try {
    const appointment = db.rescheduleAppointment(
      state.rescheduleId,
      state.pendingRescheduleSlot.startStamp,
      state.pendingRescheduleSlot.endStamp,
      state.tenantId
    );
    if (!appointment) {
      complete(response, callSid, 'I could not find that booked appointment anymore. Please call again. Goodbye.');
      return;
    }
    notifyTenantRescheduled(state, appointment, scheduling.formatStampForSpeech).catch(() => {});
    complete(
      response,
      callSid,
      `Your appointment has been moved to ${scheduling.formatStampForSpeech(
        appointment.start_time
      )}. Thank you for calling. Goodbye.`
    );
  } catch (err) {
    if (err && err.code === 'SLOT_TAKEN') {
      offerRescheduleSlots(
        response,
        state,
        'Sorry, that slot was just taken. Here are other openings.',
        nearbySlots(state.pendingRescheduleSlot?.date, state.tenantId)
      );
      return;
    }
    throw err;
  }
}

function startMessageFlow(response, state) {
  state.flow = 'awaiting-message';
  gather(response, 'I can take a message and have someone call you back. Please say your message after the tone.');
}

function saveMessage(response, state, callSid, speech) {
  db.addMessage({
    tenantId: state.tenantId,
    callerName: state.name || '',
    phone: state.from || '',
    body: speech,
  });
  complete(response, callSid, "Thank you, I've noted your message. Someone will get back to you. Goodbye.");
}

async function processSpeech(req, res) {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid || 'unknown-call';
  const state = callState(callSid, req.body.From);
  state.callSid = callSid;
  if (!attachRequiredTenantState(response, state, req)) {
    sendTwiml(res, response);
    return;
  }
  const speech = String(req.body.SpeechResult || '').trim();

  if (!speech) {
    if (state.flow === 'awaiting-message') {
      if (resetForRetry(state)) {
        gather(response, 'I did not catch your message. Please say the message you would like me to pass along.');
      } else complete(response, callSid, 'I am sorry, I still could not hear you. Please call again. Goodbye.');
    } else if (resetForRetry(state)) gather(response, 'I did not catch that. Please say how I can help.');
    else complete(response, callSid, 'I am sorry, I still could not hear you. Please call again. Goodbye.');
    sendTwiml(res, response);
    return;
  }
  state.retries = 0;

  if (state.flow === 'awaiting-name') {
    const parsed = await parseTenantIntent(speech, state);
    state.name = parsed.name || speech.replace(/[^\p{L}\p{M} .'-]/gu, '').trim() || 'Caller';
    askBookingConfirmation(response, state);
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-book-confirmation') {
    if (isYes(speech)) bookPending(response, state, callSid);
    else if (isNo(speech)) {
      state.pendingSlot = null;
      state.flow = 'awaiting-book-time';
      gather(response, 'No problem. What day and time would you prefer?');
    } else gather(response, 'Please say yes to confirm this appointment, or no to choose another time.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-slot-choice') {
    const choice = parseOrdinal(speech);
    const parsed = await parseTenantIntent(speech, state);
    const chosen =
      state.offeredSlots?.[choice] || slotFromDateTime(parsed.date || state.requestedDate, parsed.time, state.tenantId);
    if (isUsableSlot(chosen, null, state.tenantId)) {
      state.pendingSlot = chosen;
      if (!state.name) askForName(response, state);
      else askBookingConfirmation(response, state);
    } else gather(response, 'I could not match that to an available option. Please say option one, two, or three.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-book-time') {
    const parsed = await parseTenantIntent(speech, state);
    if (!parsed.date && !parsed.time) {
      const dateTime = parseDateTime(speech);
      parsed.date = dateTime.date;
      parsed.time = dateTime.time;
    }
    handleBook(response, state, parsed);
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-cancel-choice') {
    const choice = parseOrdinal(speech);
    const appt = state.cancelOptions?.[choice];
    if (!appt) {
      gather(response, 'I could not tell which appointment. Please say option one, two, or three.');
    } else {
      state.pendingCancelId = appt.id;
      state.flow = 'awaiting-cancel-confirmation';
      gather(response, `Should I cancel your appointment on ${scheduling.formatStampForSpeech(appt.start_time)}?`);
    }
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-cancel-confirmation') {
    if (isYes(speech)) {
      const ok = db.cancelAppointment(state.pendingCancelId, state.tenantId);
      complete(response, callSid, ok ? 'Your appointment has been cancelled. Goodbye.' : 'That appointment was already cancelled. Goodbye.');
    } else if (isNo(speech)) complete(response, callSid, 'Okay, I will leave your appointment as is. Goodbye.');
    else gather(response, 'Please say yes to cancel it, or no to keep it.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-reschedule-pick') {
    const choice = parseOrdinal(speech);
    const appt = state.rescheduleOptions?.[choice];
    if (!appt) {
      gather(response, 'I could not tell which appointment. Please say option one, two, or three.');
    } else {
      askForRescheduleTime(response, state, appt);
    }
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-reschedule-time') {
    const parsed = await parseTenantIntent(speech, state);
    if (!parsed.date && !parsed.time) {
      const dateTime = parseDateTime(speech);
      parsed.date = dateTime.date;
      parsed.time = dateTime.time;
    }
    handleRescheduleTime(response, state, parsed);
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-reschedule-slot-choice') {
    const choice = parseOrdinal(speech);
    const parsed = await parseTenantIntent(speech, state);
    const chosen =
      state.offeredSlots?.[choice] ||
      slotFromDateTime(parsed.date || state.requestedRescheduleDate, parsed.time, state.tenantId);
    if (isUsableSlot(chosen, state.rescheduleId, state.tenantId)) {
      state.pendingRescheduleSlot = chosen;
      askRescheduleConfirmation(response, state);
    } else gather(response, 'I could not match that to an available option. Please say option one, two, or three.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-reschedule-confirmation') {
    if (isYes(speech)) reschedulePending(response, state, callSid);
    else if (isNo(speech)) {
      state.pendingRescheduleSlot = null;
      state.flow = 'awaiting-reschedule-time';
      gather(response, 'No problem. What new day and time would you prefer?');
    } else gather(response, 'Please say yes to move your appointment, or no to choose another time.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-message') {
    saveMessage(response, state, callSid, speech);
    sendTwiml(res, response);
    return;
  }

  const parsed = await parseTenantIntent(speech, state);
  if (parsed.intent === 'book') handleBook(response, state, parsed);
  else if (parsed.intent === 'cancel') handleCancel(response, state);
  else if (parsed.intent === 'reschedule') handleReschedule(response, state);
  else if (parsed.intent === 'check-availability') handleAvailability(response, state, parsed);
  else if (parsed.intent === 'speak-to-human' || parsed.intent === 'leave-message') startMessageFlow(response, state);
  else {
    state.flow = 'idle';
    gather(response, 'I can help book, cancel, reschedule, check available appointment times, or take a message. Which would you like?');
  }

  sendTwiml(res, response);
}

function safe(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (_err) {
      const response = new VoiceResponse();
      response.tenantId = tenancy.getDefaultTenantId();
      gather(response, 'I am sorry, something went wrong. Please try saying your request again.');
      sendTwiml(res, response);
    }
  };
}

router.post(['/', '/incoming'], safe(async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid || 'unknown-call';
  const state = callState(callSid, req.body.From);
  const tenantContext = resolveTenantContext(req, state, { rejectUnmatchedTo: true });
  if (!tenantContext.tenantId) {
    response.tenantId = tenancy.getDefaultTenantId();
    sayAndHangup(response, 'Sorry, this number is not configured yet. Goodbye.');
    sendTwiml(res, response);
    return;
  }
  attachTenantState(response, state, tenantContext);
  askForInitial(response);
  sendTwiml(res, response);
}));

router.post('/respond', safe(processSpeech));
router.post('/reprompt', safe(async (req, res) => {
  const response = new VoiceResponse();
  const state = callState(req.body.CallSid || 'unknown-call', req.body.From);
  if (!attachRequiredTenantState(response, state, req)) {
    sendTwiml(res, response);
    return;
  }
  if (resetForRetry(state)) askForInitial(response);
  else complete(response, req.body.CallSid || 'unknown-call', 'I did not receive a response. Please call again. Goodbye.');
  sendTwiml(res, response);
}));

router.post('/status', (req, res) => {
  if (req.body.CallSid) calls.delete(req.body.CallSid);
  res.sendStatus(204);
});

module.exports = router;
