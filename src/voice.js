'use strict';

const express = require('express');
const twilio = require('twilio');
const config = require('./config');
const db = require('./db');
const scheduling = require('./scheduling');
const { parseIntent } = require('./nlu');
const { parseDateTime } = require('./datetime-parse');
const { notifyRescheduled } = require('./notify');

const { VoiceResponse } = twilio.twiml;
const router = express.Router();
const calls = new Map();

function callState(callSid, from) {
  if (!calls.has(callSid)) calls.set(callSid, { from, retries: 0, flow: 'idle' });
  const state = calls.get(callSid);
  state.from = from || state.from;
  return state;
}

function actionUrl(path) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/, '')}/voice${path}`;
  return `/voice${path}`;
}

function sendTwiml(res, response) {
  res.type('text/xml').send(response.toString());
}

function gather(response, prompt, action = '/respond') {
  const g = response.gather({
    input: 'speech',
    action: actionUrl(action),
    method: 'POST',
    speechTimeout: 'auto',
    timeout: 6,
  });
  g.say(prompt);
  response.redirect({ method: 'POST' }, actionUrl('/reprompt'));
}

function sayAndHangup(response, message) {
  response.say(message);
  response.hangup();
}

function slotSpeech(slot) {
  return scheduling.formatStampForSpeech(slot.startStamp);
}

function slotsPrompt(slots) {
  return slots.map((slot, i) => `Option ${i + 1}: ${slotSpeech(slot)}`).join('. ');
}

function slotFromDateTime(date, time) {
  if (!date || !time) return null;
  const length = db.getSettings().appointmentLengthMinutes;
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

function isUsableSlot(slot, excludeId) {
  if (!slot) return false;
  return slot.startStamp >= scheduling.nowStamp() && db.isSlotFree(slot.startStamp, slot.endStamp, excludeId);
}

function nearbySlots(date, count = 3) {
  const settings = db.getSettings();
  return scheduling.getNextAvailableSlots(
    date || scheduling.todayDateStr(),
    count,
    21,
    settings.appointmentLengthMinutes
  );
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
  gather(
    response,
    'Hello, I am the AI secretary. You can book, cancel, or reschedule an appointment, ask what times are available, or leave a message. How can I help?'
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
    const slot = slotFromDateTime(state.requestedDate, parsed.time);
    if (isUsableSlot(slot)) {
      state.pendingSlot = slot;
      if (!state.name) askForName(response, state);
      else askBookingConfirmation(response, state);
      return;
    }
    offerSlots(response, state, 'Sorry, that time is not available. Here are the next openings.', nearbySlots(state.requestedDate));
    return;
  }

  const date = state.requestedDate || scheduling.todayDateStr();
  const daySlots = scheduling.getAvailableSlots(date, {
    lengthMinutes: db.getSettings().appointmentLengthMinutes,
  });
  offerSlots(response, state, 'Here are available times.', daySlots.slice(0, 4));
}

function bookPending(response, state, callSid) {
  try {
    const appointment = db.bookAppointment({
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
      offerSlots(response, state, 'Sorry, that slot was just taken. Here are other openings.', nearbySlots(state.pendingSlot.date));
      return;
    }
    throw err;
  }
}

function handleAvailability(response, state, parsed) {
  const date = parsed.date || scheduling.todayDateStr();
  const slots = scheduling.getAvailableSlots(date, {
    lengthMinutes: db.getSettings().appointmentLengthMinutes,
  });
  const available = slots.length ? slots.slice(0, 4) : nearbySlots(date, 4);
  if (!available.length) {
    complete(response, state.callSid, 'I do not see available appointments soon. Please call again later. Goodbye.');
    return;
  }
  complete(response, state.callSid, `The next available times are: ${slotsPrompt(available)}. Goodbye.`);
}

function handleCancel(response, state) {
  const appointments = db.findAppointmentsByPhone(state.from || '', { upcomingOnly: true });
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
  const appointments = db.findAppointmentsByPhone(state.from || '', { upcomingOnly: true });
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
    const slot = slotFromDateTime(state.requestedRescheduleDate, parsed.time);
    if (isUsableSlot(slot, state.rescheduleId)) {
      state.pendingRescheduleSlot = slot;
      askRescheduleConfirmation(response, state);
      return;
    }
    offerRescheduleSlots(
      response,
      state,
      'Sorry, that time is not available. Here are the next openings.',
      nearbySlots(state.requestedRescheduleDate)
    );
    return;
  }

  const date = state.requestedRescheduleDate || scheduling.todayDateStr();
  const daySlots = scheduling.getAvailableSlots(date, {
    lengthMinutes: db.getSettings().appointmentLengthMinutes,
  });
  offerRescheduleSlots(response, state, 'Here are available times.', daySlots.slice(0, 4));
}

function reschedulePending(response, state, callSid) {
  try {
    const appointment = db.rescheduleAppointment(
      state.rescheduleId,
      state.pendingRescheduleSlot.startStamp,
      state.pendingRescheduleSlot.endStamp
    );
    if (!appointment) {
      complete(response, callSid, 'I could not find that booked appointment anymore. Please call again. Goodbye.');
      return;
    }
    notifyRescheduled(appointment, scheduling.formatStampForSpeech).catch(() => {});
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
        nearbySlots(state.pendingRescheduleSlot?.date)
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
    const parsed = await parseIntent(speech, state);
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
    const parsed = await parseIntent(speech, state);
    const chosen = state.offeredSlots?.[choice] || slotFromDateTime(parsed.date || state.requestedDate, parsed.time);
    if (isUsableSlot(chosen)) {
      state.pendingSlot = chosen;
      if (!state.name) askForName(response, state);
      else askBookingConfirmation(response, state);
    } else gather(response, 'I could not match that to an available option. Please say option one, two, or three.');
    sendTwiml(res, response);
    return;
  }

  if (state.flow === 'awaiting-book-time') {
    const parsed = await parseIntent(speech, state);
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
      const ok = db.cancelAppointment(state.pendingCancelId);
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
    const parsed = await parseIntent(speech, state);
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
    const parsed = await parseIntent(speech, state);
    const chosen = state.offeredSlots?.[choice] || slotFromDateTime(parsed.date || state.requestedRescheduleDate, parsed.time);
    if (isUsableSlot(chosen, state.rescheduleId)) {
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

  const parsed = await parseIntent(speech, state);
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
      gather(response, 'I am sorry, something went wrong. Please try saying your request again.');
      sendTwiml(res, response);
    }
  };
}

router.post(['/', '/incoming'], safe(async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid || 'unknown-call';
  callState(callSid, req.body.From);
  askForInitial(response);
  sendTwiml(res, response);
}));

router.post('/respond', safe(processSpeech));
router.post('/reprompt', safe(async (req, res) => {
  const response = new VoiceResponse();
  const state = callState(req.body.CallSid || 'unknown-call', req.body.From);
  if (resetForRetry(state)) askForInitial(response);
  else complete(response, req.body.CallSid || 'unknown-call', 'I did not receive a response. Please call again. Goodbye.');
  sendTwiml(res, response);
}));

router.post('/status', (req, res) => {
  if (req.body.CallSid) calls.delete(req.body.CallSid);
  res.sendStatus(204);
});

module.exports = router;
