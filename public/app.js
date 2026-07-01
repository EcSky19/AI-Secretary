'use strict';

const state = {
  settings: null,
  appointments: [],
  availableSlots: [],
  upcoming: [],
  messages: [],
  unreadCount: 0,
  phone: null,
  calendar: null,
  config: null,
  setupStatus: null,
  availableNumbers: [],
  backups: [],
  backupDir: '',
};

const els = {
  date: document.querySelector('#schedule-date'),
  summary: document.querySelector('#schedule-summary'),
  slots: document.querySelector('#slots'),
  message: document.querySelector('#message'),
  settingsForm: document.querySelector('#settings-form'),
  length: document.querySelector('#appointment-length'),
  businessStart: document.querySelector('#business-start'),
  businessEnd: document.querySelector('#business-end'),
  openDays: [...document.querySelectorAll('[name="open-day"]')],
  blackoutDate: document.querySelector('#blackout-date'),
  addBlackoutDate: document.querySelector('#add-blackout-date'),
  blackoutList: document.querySelector('#blackout-list'),
  reminderLead: document.querySelector('#reminder-lead'),
  authBanner: document.querySelector('#auth-banner'),
  dismissAuthBanner: document.querySelector('#dismiss-auth-banner'),
  calendarUrl: document.querySelector('#calendar-url'),
  calendarLink: document.querySelector('.calendar-link'),
  dialog: document.querySelector('#booking-dialog'),
  bookingForm: document.querySelector('#booking-form'),
  bookingTime: document.querySelector('#booking-time'),
  bookingStart: document.querySelector('#booking-start'),
  bookingName: document.querySelector('#booking-name'),
  bookingPhone: document.querySelector('#booking-phone'),
  bookingReason: document.querySelector('#booking-reason'),
  closeDialog: document.querySelector('#close-dialog'),
  cancelBooking: document.querySelector('#cancel-booking'),
  upcomingList: document.querySelector('#upcoming-list'),
  messagesList: document.querySelector('#messages-list'),
  unreadCount: document.querySelector('#unread-count'),
  messageFilter: document.querySelector('#message-filter'),
  rescheduleDialog: document.querySelector('#reschedule-dialog'),
  rescheduleForm: document.querySelector('#reschedule-form'),
  rescheduleTitle: document.querySelector('#reschedule-title'),
  rescheduleId: document.querySelector('#reschedule-id'),
  rescheduleDate: document.querySelector('#reschedule-date'),
  rescheduleTime: document.querySelector('#reschedule-time'),
  closeReschedule: document.querySelector('#close-reschedule'),
  cancelReschedule: document.querySelector('#cancel-reschedule'),
  phonePanel: document.querySelector('#phone-panel'),
  phoneActions: document.querySelector('#phone-actions'),
  ownedPhoneNumber: document.querySelector('#owned-phone-number'),
  registerPhoneNumber: document.querySelector('#register-phone-number'),
  availablePhoneForm: document.querySelector('#available-phone-form'),
  phoneAreaCode: document.querySelector('#phone-area-code'),
  phoneContains: document.querySelector('#phone-contains'),
  availablePhoneResults: document.querySelector('#available-phone-results'),
  dashboardTitle: document.querySelector('#dashboard-title'),
  pageTitle: document.querySelector('#page-title'),
  businessConfigForm: document.querySelector('#business-config-form'),
  configBusinessName: document.querySelector('#config-business-name'),
  voiceConfigForm: document.querySelector('#voice-config-form'),
  assistantVoice: document.querySelector('#assistant-voice'),
  assistantVoiceHelp: document.querySelector('#assistant-voice-help'),
  saveAssistantVoice: document.querySelector('#save-assistant-voice'),
  aiUnderstandingForm: document.querySelector('#ai-understanding-form'),
  openaiApiKey: document.querySelector('#openai-api-key'),
  openaiModel: document.querySelector('#openai-model'),
  aiUnderstandingHelp: document.querySelector('#ai-understanding-help'),
  saveAiUnderstanding: document.querySelector('#save-ai-understanding'),
  recoveryPhoneForm: document.querySelector('#recovery-phone-form'),
  recoveryPhone: document.querySelector('#recovery-phone'),
  recoveryEmailForm: document.querySelector('#recovery-email-form'),
  recoveryEmail: document.querySelector('#recovery-email'),
  configMessage: document.querySelector('#config-message'),
  twilioStatus: document.querySelector('#twilio-status'),
  emailConfigForm: document.querySelector('#email-config-form'),
  emailStatus: document.querySelector('#email-status'),
  emailHost: document.querySelector('#email-host'),
  emailPort: document.querySelector('#email-port'),
  emailSecure: document.querySelector('#email-secure'),
  emailUser: document.querySelector('#email-user'),
  emailPass: document.querySelector('#email-pass'),
  emailPassHelp: document.querySelector('#email-pass-help'),
  emailFrom: document.querySelector('#email-from'),
  emailTestResult: document.querySelector('#email-test-result'),
  testEmailConfig: document.querySelector('#test-email-config'),
  adminPasswordForm: document.querySelector('#admin-password-form'),
  adminUser: document.querySelector('#admin-user'),
  adminPassword: document.querySelector('#admin-password'),
  adminPasswordConfirm: document.querySelector('#admin-password-confirm'),
  exportStatus: document.querySelector('#export-status'),
  exportCsv: document.querySelector('#export-csv'),
  backupNow: document.querySelector('#backup-now'),
  backupMessage: document.querySelector('#backup-message'),
  backupDir: document.querySelector('#backup-dir'),
  backupList: document.querySelector('#backup-list'),
  logoutButton: document.querySelector('#logout-button'),
  accountLogoutButton: document.querySelector('#account-logout-button'),
};

function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentLocalStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hour}:${minute}`;
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime(time) {
  const [hourRaw, minute] = time.split(':').map(Number);
  const period = hourRaw >= 12 ? 'PM' : 'AM';
  const hour = hourRaw % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
}

function formatStamp(stamp) {
  if (!stamp || !stamp.includes('T')) return '';
  const [date, time] = stamp.split('T');
  return `${formatDate(date)} ${formatTime(time)}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} bytes`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) redirectToLogin();
    const responseError = typeof data.error === 'string' ? data.error : (data.error && data.error.message);
    const err = new Error(response.status === 401
      ? 'Authentication required. Please sign in.'
      : (responseError || `Request failed (${response.status})`));
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiBlob(path, options = {}) {
  const response = await fetch(path, {
    headers: { ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    if (response.status === 401) redirectToLogin();
    const data = await response.json().catch(() => ({}));
    const responseError = typeof data.error === 'string' ? data.error : (data.error && data.error.message);
    const err = new Error(response.status === 401
      ? 'Authentication required. Please sign in.'
      : (responseError || `Request failed (${response.status})`));
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return response.blob();
}

function showAuthBanner() {
  if (els.authBanner) els.authBanner.hidden = false;
}

function redirectToLogin() {
  showAuthBanner();
  const next = `${window.location.pathname || '/'}${window.location.hash || ''}`;
  window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
}

function friendlyError(err) {
  if (err.status === 409 && err.data && Array.isArray(err.data.nextAvailableSlots)) {
    const options = err.data.nextAvailableSlots.slice(0, 3).map(slot => {
      const stamp = typeof slot === 'string' ? slot : (slot.startStamp || slot.start_time || slot.start || '');
      return formatStamp(stamp);
    }).filter(Boolean);
    return options.length ? `${err.message} Next openings: ${options.join(', ')}.` : err.message;
  }
  return err.message;
}

function showMessage(text, type = 'success') {
  showInlineMessage(els.message, text, type);
}

function showConfigMessage(text, type = 'success') {
  showInlineMessage(els.configMessage, text, type);
}

function showBackupMessage(text, type = 'success') {
  showInlineMessage(els.backupMessage, text, type);
}

function showInlineMessage(element, text, type = 'success') {
  if (!element) return;
  element.textContent = text;
  element.className = `message show ${type}`;
  clearTimeout(element.messageTimer);
  element.messageTimer = setTimeout(() => { element.className = 'message'; }, 5000);
}

function renderNotice(element, result) {
  if (!element) return;
  element.hidden = false;
  if (result && result.ok) {
    element.className = 'notice good';
    element.textContent = `Connection works${result.friendlyName ? ` - ${result.friendlyName}` : ''}.`;
    return;
  }
  element.className = 'notice error';
  element.textContent = result && result.error ? result.error : 'Connection test failed.';
}

function dayBounds(date) {
  return { from: `${date}T00:00`, to: `${date}T23:59` };
}

function generateSlots() {
  const settings = state.settings;
  const slots = [];
  const start = toMinutes(settings.businessHoursStart);
  const end = toMinutes(settings.businessHoursEnd);
  const length = settings.appointmentLengthMinutes;
  for (let t = start; t + length <= end; t += length) {
    slots.push({ start: toTime(t), end: toTime(t + length), startStamp: `${els.date.value}T${toTime(t)}` });
  }
  return slots;
}

function openDayForSelectedDate() {
  const openDays = Array.isArray(state.settings.openDays) ? state.settings.openDays : [];
  if (!openDays.length) return true;
  const [year, month, day] = els.date.value.split('-').map(Number);
  return openDays.includes(new Date(year, month - 1, day).getDay());
}

function findAppointmentForSlot(slot) {
  const slotEnd = `${els.date.value}T${slot.end}`;
  return state.appointments.find(appt =>
    appt.status === 'booked' && appt.start_time < slotEnd && appt.end_time > slot.startStamp
  );
}

function renderSettings() {
  els.length.value = state.settings.appointmentLengthMinutes;
  els.businessStart.value = state.settings.businessHoursStart;
  els.businessEnd.value = state.settings.businessHoursEnd;
  els.reminderLead.value = state.settings.reminderLeadMinutes || 60;
  const openDays = Array.isArray(state.settings.openDays) ? state.settings.openDays : [0, 1, 2, 3, 4, 5, 6];
  els.openDays.forEach(input => { input.checked = openDays.includes(Number(input.value)); });
  renderBlackoutDates();
}

function renderConfig() {
  const config = state.config || {};
  const emailConfig = config.email || {};
  const businessName = config.businessName || (state.setupStatus && state.setupStatus.businessName) || 'AI Secretary';
  if (els.dashboardTitle) els.dashboardTitle.textContent = `${businessName} - Schedule`;
  if (els.pageTitle) els.pageTitle.textContent = `${businessName} - Schedule`;
  if (els.configBusinessName) els.configBusinessName.value = businessName;
  if (els.assistantVoice) {
    const voiceOptions = Array.isArray(config.voiceOptions) ? config.voiceOptions : [];
    const voiceName = config.voiceName || '';
    const hasCurrentVoice = voiceOptions.some(option => option && option.name === voiceName);
    const options = voiceOptions.map(option => `
      <option value="${escapeHtml(option.name)}">${escapeHtml(option.label || option.name)}</option>
    `);
    if (voiceName && !hasCurrentVoice) {
      options.unshift(`<option value="${escapeHtml(voiceName)}">${escapeHtml(voiceName)}</option>`);
    }
    els.assistantVoice.innerHTML = options.length
      ? options.join('')
      : '<option value="">No voices available</option>';
    els.assistantVoice.value = voiceName;
    els.assistantVoice.disabled = Boolean(config.voiceEnvManaged) || !voiceOptions.length;
  }
  if (els.saveAssistantVoice) {
    const voiceOptions = Array.isArray(config.voiceOptions) ? config.voiceOptions : [];
    els.saveAssistantVoice.disabled = Boolean(config.voiceEnvManaged) || !voiceOptions.length;
  }
  if (els.assistantVoiceHelp) {
    const voiceOptions = Array.isArray(config.voiceOptions) ? config.voiceOptions : [];
    const selected = voiceOptions.find(option => option && option.name === config.voiceName);
    const selectedLabel = selected ? selected.label : config.voiceName;
    els.assistantVoiceHelp.textContent = config.voiceEnvManaged
      ? `${selectedLabel || 'The assistant voice'}. Set by your hosting configuration.`
      : 'This natural voice is what callers hear when the assistant answers your phone. Changes apply to the next call.';
  }
  const aiUnderstanding = config.aiUnderstanding || {};
  const aiEnvManaged = Boolean(aiUnderstanding.envManaged);
  if (els.openaiApiKey) {
    els.openaiApiKey.value = '';
    els.openaiApiKey.placeholder = aiUnderstanding.hasApiKey ? '•••• configured' : 'sk-...';
    els.openaiApiKey.disabled = aiEnvManaged;
  }
  if (els.openaiModel) {
    els.openaiModel.value = aiUnderstanding.model || '';
    els.openaiModel.disabled = aiEnvManaged;
  }
  if (els.saveAiUnderstanding) {
    els.saveAiUnderstanding.disabled = aiEnvManaged;
  }
  if (els.aiUnderstandingHelp) {
    const status = aiUnderstanding.enabled ? 'enabled' : 'disabled';
    els.aiUnderstandingHelp.textContent = aiEnvManaged
      ? `AI understanding is ${status}. Configured via OPENAI_API_KEY environment variable.`
      : `AI understanding is ${status}. ${aiUnderstanding.hasApiKey ? 'A key is configured.' : 'No key is configured.'} When configured, callers' requests are understood by an AI model for more natural, flexible phrasing. Without a key, a built-in rule-based parser is used, so the phone line still works.`;
  }
  if (els.recoveryPhone) els.recoveryPhone.value = config.recoveryPhone || '';
  if (els.recoveryEmail) els.recoveryEmail.value = config.recoveryEmail || '';
  if (els.adminUser) els.adminUser.value = config.adminUser || '';
  if (els.twilioStatus) {
    const numberText = config.smsFromNumber ? `Assigned number: ${config.smsFromNumber}` : 'No number assigned yet.';
    els.twilioStatus.className = `notice ${config.smsFromNumber ? 'good' : 'info'}`;
    els.twilioStatus.textContent = `${numberText} Use the Phone Number panel to get or assign a number.`;
  }
  if (els.emailHost) els.emailHost.value = emailConfig.host || '';
  if (els.emailPort) els.emailPort.value = emailConfig.port || 587;
  if (els.emailSecure) els.emailSecure.checked = Boolean(emailConfig.secure);
  if (els.emailUser) els.emailUser.value = emailConfig.user || '';
  if (els.emailPass) els.emailPass.value = '';
  if (els.emailPassHelp) {
    els.emailPassHelp.textContent = emailConfig.hasPassword
      ? 'Leave blank to keep the current password.'
      : 'Enter the SMTP password or app password.';
  }
  if (els.emailFrom) els.emailFrom.value = emailConfig.from || '';
  if (els.emailStatus) {
    const configured = Boolean(config.emailConfigured);
    els.emailStatus.className = `notice ${configured ? 'good' : 'warn'}`;
    const passwordText = emailConfig.hasPassword ? 'SMTP password saved' : 'SMTP password not saved';
    const fromText = emailConfig.from ? `From: ${emailConfig.from}` : 'No from address saved yet';
    els.emailStatus.textContent = configured
      ? `Email is connected. ${passwordText}. ${fromText}.`
      : `Email is not connected yet. ${passwordText}. ${fromText}.`;
  }
  if (typeof window.renderAccount === 'function') window.renderAccount();
}

function renderBlackoutDates() {
  const dates = Array.isArray(state.settings.blackoutDates) ? state.settings.blackoutDates : [];
  if (!dates.length) {
    els.blackoutList.innerHTML = '<div class="empty compact">No blackout dates.</div>';
    return;
  }
  els.blackoutList.innerHTML = dates.map(date => `
    <div class="blackout-item">
      <span>${escapeHtml(date)}</span>
      <button type="button" class="danger" data-remove-blackout="${escapeHtml(date)}">Remove</button>
    </div>
  `).join('');
}

function renderSchedule() {
  const slots = generateSlots();
  const availableStarts = new Set(state.availableSlots.map(slot => slot.startStamp || `${slot.date}T${slot.start}`));
  const visibleSlots = slots.filter(slot => findAppointmentForSlot(slot) || availableStarts.has(slot.startStamp));
  const bookedCount = state.appointments.filter(a => a.status === 'booked').length;
  els.summary.textContent = `${state.availableSlots.length} available slots • ${bookedCount} booked • ${state.settings.appointmentLengthMinutes} minute appointments`;
  if (!visibleSlots.length) {
    const blackoutDates = Array.isArray(state.settings.blackoutDates) ? state.settings.blackoutDates : [];
    const closed = blackoutDates.includes(els.date.value) || !openDayForSelectedDate();
    els.slots.innerHTML = `<div class="empty">${closed ? 'This date is closed.' : 'No bookable slots for this date.'}</div>`;
    return;
  }
  els.slots.innerHTML = visibleSlots.map(slot => {
    const appt = findAppointmentForSlot(slot);
    if (appt) {
      return `<article class="slot booked">
        <div class="slot-time">${formatTime(slot.start)}<span class="slot-end">to ${formatTime(slot.end)}</span></div>
        <div><div class="slot-title">${escapeHtml(appt.name)}</div>
          <div class="slot-meta"><span>${escapeHtml(appt.reason) || 'No reason'}</span><span>${escapeHtml(appt.phone) || 'No phone'}</span></div></div>
        <div class="button-row">
          <button class="secondary" data-reschedule="${appt.id}">Reschedule</button>
          <button class="danger" data-cancel="${appt.id}">Cancel</button>
        </div>
      </article>`;
    }
    return `<article class="slot">
      <div class="slot-time">${formatTime(slot.start)}<span class="slot-end">to ${formatTime(slot.end)}</span></div>
      <div><div class="slot-title">Available</div><div class="slot-meta">Ready for booking</div></div>
      <button class="primary" data-book="${slot.startStamp}" data-label="${formatTime(slot.start)}">Book</button>
    </article>`;
  }).join('');
}

function renderUpcoming() {
  if (!state.upcoming.length) {
    els.upcomingList.innerHTML = '<div class="empty">No upcoming booked appointments.</div>';
    return;
  }
  els.upcomingList.innerHTML = state.upcoming.map(appt => `
    <article class="list-item appointment-item">
      <div>
        <div class="slot-title">${escapeHtml(formatStamp(appt.start_time))}</div>
        <div class="slot-meta">
          <span>${escapeHtml(appt.name)}</span>
          <span>${escapeHtml(appt.phone) || 'No phone'}</span>
        </div>
        <p>${escapeHtml(appt.reason) || 'No reason provided'}</p>
      </div>
      <div class="button-row">
        <button class="secondary" data-reschedule="${appt.id}">Reschedule</button>
        <button class="danger" data-cancel="${appt.id}">Cancel</button>
      </div>
    </article>
  `).join('');
}

function renderMessages() {
  els.unreadCount.textContent = `${state.unreadCount} new`;
  if (!state.messages.length) {
    els.messagesList.innerHTML = '<div class="empty">No messages to show.</div>';
    return;
  }
  els.messagesList.innerHTML = state.messages.map(message => {
    const isNew = message.status === 'new';
    return `
      <article class="list-item message-item ${isNew ? 'unread' : ''}">
        <div>
          <div class="message-heading">
            <span class="slot-title">${escapeHtml(message.caller_name) || 'Unknown caller'}</span>
            ${isNew ? '<span class="badge">new</span>' : ''}
          </div>
          <div class="slot-meta">
            <span>${escapeHtml(message.phone) || 'No phone'}</span>
            <span>${escapeHtml(formatStamp(message.created_at ? message.created_at.slice(0, 16) : ''))}</span>
          </div>
          <p>${escapeHtml(message.body)}</p>
        </div>
        <div class="button-row">
          <button class="secondary" data-message-status="${message.id}" data-status="${isNew ? 'read' : 'new'}">${isNew ? 'Mark read' : 'Mark new'}</button>
          <button class="danger" data-message-delete="${message.id}">Delete</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderPhone() {
  const phone = state.phone || {};
  const activeNumber = phone.activeNumber || phone.phoneNumber || phone.assignedNumber || (state.config && state.config.smsFromNumber) || '';
  const registeredLabel = phone.registered || activeNumber ? 'Assigned' : 'Not assigned';
  const statusClass = activeNumber ? 'good' : 'warn';
  const emptyNotice = activeNumber
    ? ''
    : '<div class="notice info">Choose a new number or assign an existing platform-owned number. You do not need Twilio credentials.</div>';
  const platformNotice = phone.configured === false
    ? '<div class="notice warn">Number provisioning is not available yet. You can keep managing your schedule and try again later.</div>'
    : '';
  const localhostNotice = phone.usingLocalhost
    ? '<div class="notice warn">PUBLIC_BASE_URL is localhost, so clients cannot reach this webhook. Use a tunnel such as ngrok or set a public URL.</div>'
    : '';
  const registeredNotice = `<div class="notice ${statusClass}">Phone number is ${registeredLabel.toLowerCase()}.</div>`;

  els.phonePanel.innerHTML = `
    <div class="phone-summary">
      <div>
        <div class="muted">Clients should call</div>
        <div class="phone-number-display">${escapeHtml(activeNumber || 'Not set')}</div>
      </div>
      <div class="phone-detail"><strong>Voice webhook:</strong> ${escapeHtml(phone.webhookUrl || 'Managed by the platform')}</div>
      <div><span class="badge">${escapeHtml(registeredLabel)}</span></div>
    </div>
    ${emptyNotice}
    ${platformNotice}
    ${localhostNotice}
    ${registeredNotice}
    ${phone.error ? `<div class="notice error">${escapeHtml(phone.error)}</div>` : ''}
  `;
  els.phoneActions.hidden = false;
}

function renderAvailablePhoneNumbers() {
  if (!state.availableNumbers.length) {
    els.availablePhoneResults.innerHTML = '<div class="empty">No available numbers to show.</div>';
    return;
  }
  els.availablePhoneResults.innerHTML = state.availableNumbers.map(number => `
    <article class="list-item">
      <div>
        <div class="slot-title">${escapeHtml(number.phoneNumber)}</div>
        <div class="slot-meta">
          <span>${escapeHtml(number.friendlyName) || 'Phone number'}</span>
          <span>${escapeHtml([number.locality, number.region].filter(Boolean).join(', '))}</span>
        </div>
      </div>
      <button class="primary" data-provision-phone="${escapeHtml(number.phoneNumber)}">Claim number</button>
    </article>
  `).join('');
}

function renderBackups() {
  els.backupDir.textContent = state.backupDir
    ? `Backup location: ${state.backupDir}`
    : 'Backup location is not available yet.';
  if (!state.backups.length) {
    els.backupList.innerHTML = '<div class="empty">No backups yet. Use “Back up now” to save one.</div>';
    return;
  }
  els.backupList.innerHTML = state.backups.map(backup => `
    <article class="list-item backup-item">
      <div>
        <div class="slot-title">${escapeHtml(backup.name)}</div>
        <div class="slot-meta">
          <span>${escapeHtml(formatDateTime(backup.createdAt))}</span>
          <span>${escapeHtml(formatFileSize(backup.size))}</span>
        </div>
      </div>
    </article>
  `).join('');
}

function renderBackupsError(message) {
  els.backupDir.className = 'notice error';
  els.backupDir.textContent = message;
  els.backupList.innerHTML = '<div class="empty">Backups could not be loaded.</div>';
}

async function loadBackups() {
  const data = await api('/api/backups');
  state.backupDir = data.dir || '';
  state.backups = Array.isArray(data.backups) ? data.backups : [];
  els.backupDir.className = 'notice info';
  renderBackups();
}

async function loadAll() {
  state.config = await api('/api/config');
  renderConfig();
  try {
    state.calendar = await api('/api/calendar');
  } catch (err) {
    state.calendar = { url: '', path: '', error: friendlyError(err) };
  }
  if (els.calendarUrl) els.calendarUrl.value = state.calendar.url || state.calendar.path || '/calendar.ics';
  if (els.calendarLink) els.calendarLink.href = state.calendar.url || state.calendar.path || '/calendar.ics';
  state.settings = await api('/api/settings');
  renderSettings();
  const { from, to } = dayBounds(els.date.value);
  const [availability, appointments, upcoming, messages, unread] = await Promise.all([
    api(`/api/availability?date=${encodeURIComponent(els.date.value)}`),
    api(`/api/appointments?status=booked&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    api(`/api/appointments?status=booked&from=${encodeURIComponent(currentLocalStamp())}`),
    api(`/api/messages?status=${encodeURIComponent(els.messageFilter.value || 'all')}`),
    api('/api/messages/unread-count'),
  ]);
  state.availableSlots = availability;
  state.appointments = appointments;
  state.upcoming = upcoming;
  state.messages = messages;
  state.unreadCount = unread.count || 0;
  try {
    state.phone = await api('/api/phone');
  } catch (err) {
    state.phone = {
      configured: false,
      activeNumber: state.config.smsFromNumber || '',
      error: err.status === 503
        ? 'Number provisioning is not available yet. Please try again later.'
        : friendlyError(err),
    };
  }
  renderSchedule();
  renderUpcoming();
  renderMessages();
  renderPhone();
  try {
    await loadBackups();
  } catch (err) {
    renderBackupsError(friendlyError(err));
  }
}

function openBooking(startStamp, label) {
  els.bookingStart.value = startStamp;
  els.bookingTime.textContent = `Book ${label}`;
  els.bookingName.value = '';
  els.bookingPhone.value = '';
  els.bookingReason.value = '';
  els.dialog.showModal();
  els.bookingName.focus();
}

function appointmentById(id) {
  return [...state.appointments, ...state.upcoming].find(appt => String(appt.id) === String(id));
}

function openReschedule(id) {
  const appt = appointmentById(id);
  const start = appt ? appt.start_time : `${els.date.value}T09:00`;
  const [date, time] = start.split('T');
  els.rescheduleId.value = id;
  els.rescheduleDate.value = date || els.date.value;
  els.rescheduleTime.value = time || '';
  els.rescheduleTitle.textContent = appt ? `Reschedule ${appt.name}` : 'Reschedule appointment';
  els.rescheduleDialog.showModal();
  els.rescheduleDate.focus();
}

async function cancelAppointment(id) {
  if (!confirm('Cancel this appointment?')) return;
  await api(`/api/appointments/${id}`, { method: 'DELETE' });
  showMessage('Appointment cancelled.');
  await loadAll();
}

async function updateMessageStatus(id, status) {
  await api(`/api/messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  showMessage(status === 'read' ? 'Message marked read.' : 'Message marked new.');
  await loadAll();
}

async function deleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  await api(`/api/messages/${id}`, { method: 'DELETE' });
  showMessage('Message deleted.');
  await loadAll();
}

async function registerSelectedPhoneNumber() {
  const phoneNumber = els.ownedPhoneNumber.value.trim();
  if (!phoneNumber) {
    showMessage('Enter a platform-owned phone number to assign.', 'error');
    return;
  }
  const result = await api('/api/phone/register', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  });
  if (result.ok === false) {
    showPhoneProvisioningMessage(result);
    return;
  }
  showMessage('Phone number assigned.');
  els.ownedPhoneNumber.value = '';
  await loadAll();
}

async function searchAvailablePhoneNumbers() {
  const params = new URLSearchParams();
  if (els.phoneAreaCode.value.trim()) params.set('areaCode', els.phoneAreaCode.value.trim());
  if (els.phoneContains.value.trim()) params.set('contains', els.phoneContains.value.trim());
  const data = await api(`/api/phone/available${params.toString() ? `?${params.toString()}` : ''}`);
  if (data.ok === false) {
    state.availableNumbers = [];
    renderAvailablePhoneNumbers();
    showPhoneProvisioningMessage(data);
    return;
  }
  state.availableNumbers = Array.isArray(data) ? data : (Array.isArray(data.numbers) ? data.numbers : []);
  renderAvailablePhoneNumbers();
}

async function provisionPhoneNumber(phoneNumber) {
  if (!confirm(`Claim ${phoneNumber} for this business?`)) return;
  const body = { phoneNumber };
  if (els.phoneAreaCode.value.trim()) body.areaCode = els.phoneAreaCode.value.trim();
  if (els.phoneContains.value.trim()) body.contains = els.phoneContains.value.trim();
  const result = await api('/api/phone/provision', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (result.ok === false) {
    showPhoneProvisioningMessage(result);
    return;
  }
  showMessage('Phone number claimed and assigned.');
  state.availableNumbers = [];
  renderAvailablePhoneNumbers();
  await loadAll();
}

function showPhoneProvisioningMessage(resultOrError) {
  const error = resultOrError && resultOrError.error;
  const message = typeof error === 'string'
    ? error
    : (error && error.message) || (resultOrError && resultOrError.message);
  showMessage(
    message || 'Number provisioning is not available yet. Please try again later.',
    'error'
  );
}

async function exportAppointmentsCsv() {
  const params = new URLSearchParams({ status: els.exportStatus.value || 'all' });
  els.exportCsv.disabled = true;
  try {
    const blob = await apiBlob(`/api/appointments/export.csv?${params.toString()}`, {
      headers: { Accept: 'text/csv' },
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'appointments.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage('Appointments CSV downloaded.');
  } finally {
    els.exportCsv.disabled = false;
  }
}

async function createBackupNow() {
  els.backupNow.disabled = true;
  try {
    await api('/api/backups', { method: 'POST' });
    showBackupMessage('Backup saved.');
    await loadBackups();
  } finally {
    els.backupNow.disabled = false;
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      try { localStorage.removeItem('authEmail'); } catch (e) { /* ignore */ }
      window.location.replace('/login.html');
    }
  }
}

async function saveBusinessConfig() {
  state.config = await api('/api/config/business', {
    method: 'PUT',
    body: JSON.stringify({ businessName: els.configBusinessName.value.trim() }),
  });
  showConfigMessage('Business name saved.');
  await loadAll();
}

async function saveVoiceConfig() {
  const result = await api('/api/config/voice', {
    method: 'PUT',
    body: JSON.stringify({ voiceName: els.assistantVoice.value }),
  });
  if (state.config) state.config.voiceName = result.voiceName || '';
  showConfigMessage('Assistant voice saved.');
  await loadAll();
}

async function saveAiConfig() {
  const current = (state.config && state.config.aiUnderstanding) || {};
  const apiKey = els.openaiApiKey.value.trim();
  const model = els.openaiModel.value.trim();
  const changes = {};
  if (apiKey) changes.apiKey = apiKey;
  if (model !== (current.model || '')) changes.model = model;
  if (!Object.keys(changes).length) {
    showConfigMessage('No AI understanding changes to save.');
    return;
  }
  const result = await api('/api/config/ai', {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
  if (state.config) state.config.aiUnderstanding = result.aiUnderstanding || {};
  if (els.openaiApiKey) els.openaiApiKey.value = '';
  showConfigMessage('AI understanding settings saved.');
  renderConfig();
}

async function saveRecoveryPhone() {
  const result = await api('/api/config/recovery-phone', {
    method: 'PUT',
    body: JSON.stringify({ recoveryPhone: els.recoveryPhone.value.trim() }),
  });
  if (state.config) state.config.recoveryPhone = result.recoveryPhone || '';
  if (els.recoveryPhone) els.recoveryPhone.value = result.recoveryPhone || '';
  showConfigMessage(result.recoveryPhone ? 'Recovery phone saved.' : 'Recovery phone cleared.');
}

async function saveRecoveryEmail() {
  const result = await api('/api/config/recovery-email', {
    method: 'PUT',
    body: JSON.stringify({ recoveryEmail: els.recoveryEmail.value.trim() }),
  });
  if (state.config) state.config.recoveryEmail = result.recoveryEmail || '';
  if (els.recoveryEmail) els.recoveryEmail.value = result.recoveryEmail || '';
  showConfigMessage(result.recoveryEmail ? 'Recovery email saved.' : 'Recovery email cleared.');
}

function emailConfigBody({ includeTest = false } = {}) {
  const body = {
    host: els.emailHost.value.trim(),
    port: Number(els.emailPort.value || 587),
    secure: els.emailSecure.checked,
    user: els.emailUser.value.trim(),
    from: els.emailFrom.value.trim(),
  };
  if (els.emailPass.value) body.pass = els.emailPass.value;
  if (includeTest) body.test = false;
  return body;
}

async function testEmailConfig() {
  const result = await api('/api/config/email/test', {
    method: 'POST',
    body: JSON.stringify(emailConfigBody()),
  });
  renderNotice(els.emailTestResult, result);
}

async function saveEmailConfig() {
  const result = await api('/api/config/email', {
    method: 'PUT',
    body: JSON.stringify(emailConfigBody({ includeTest: true })),
  });
  if (result.test && result.test.ok === false) renderNotice(els.emailTestResult, result.test);
  showConfigMessage(result.emailConfigured ? 'Email settings saved and connected.' : 'Email settings saved.');
  await loadAll();
}

async function changeAdminPassword() {
  const password = els.adminPassword.value;
  if (password !== els.adminPasswordConfirm.value) {
    showConfigMessage('Passwords do not match.', 'error');
    return;
  }
  await api('/api/config/admin-password', {
    method: 'PUT',
    body: JSON.stringify({ password, user: els.adminUser.value.trim() || 'admin' }),
  });
  els.adminPassword.value = '';
  els.adminPasswordConfirm.value = '';
  showConfigMessage('Admin login updated. Reload the page if your browser asks you to sign in again.');
  await loadAll();
}

async function initialize() {
  try {
    state.setupStatus = await api('/api/setup/status');
    if (state.setupStatus.businessName && els.dashboardTitle) {
      els.dashboardTitle.textContent = `${state.setupStatus.businessName} - Schedule`;
    }
    els.calendarUrl.value = `${window.location.origin}/calendar.ics`;
    els.date.value = todayLocalDate();
    await loadAll();
  } catch (err) {
    showMessage(friendlyError(err), 'error');
  }
}

els.date.addEventListener('change', () => loadAll().catch(err => showMessage(err.message, 'error')));
els.settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        appointmentLengthMinutes: Number(els.length.value),
        businessHoursStart: els.businessStart.value,
        businessHoursEnd: els.businessEnd.value,
        openDays: els.openDays.filter(input => input.checked).map(input => Number(input.value)),
        blackoutDates: Array.isArray(state.settings.blackoutDates) ? state.settings.blackoutDates : [],
        reminderLeadMinutes: Number(els.reminderLead.value),
      }),
    });
    showMessage('Settings saved.');
    await loadAll();
  } catch (err) {
    showMessage(err.message, 'error');
  }
});

els.addBlackoutDate.addEventListener('click', () => {
  const date = els.blackoutDate.value;
  if (!date) {
    showMessage('Choose a blackout date to add.', 'error');
    return;
  }
  const dates = new Set(Array.isArray(state.settings.blackoutDates) ? state.settings.blackoutDates : []);
  dates.add(date);
  state.settings.blackoutDates = [...dates].sort();
  els.blackoutDate.value = '';
  renderBlackoutDates();
});

els.blackoutList.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-blackout]');
  if (!button) return;
  state.settings.blackoutDates = (state.settings.blackoutDates || []).filter(date => date !== button.dataset.removeBlackout);
  renderBlackoutDates();
});

els.slots.addEventListener('click', async event => {
  const bookButton = event.target.closest('[data-book]');
  const cancelButton = event.target.closest('[data-cancel]');
  const rescheduleButton = event.target.closest('[data-reschedule]');
  if (bookButton) openBooking(bookButton.dataset.book, bookButton.dataset.label);
  if (rescheduleButton) openReschedule(rescheduleButton.dataset.reschedule);
  if (cancelButton) {
    try {
      await cancelAppointment(cancelButton.dataset.cancel);
    } catch (err) {
      showMessage(friendlyError(err), 'error');
    }
  }
});

els.upcomingList.addEventListener('click', async event => {
  const cancelButton = event.target.closest('[data-cancel]');
  const rescheduleButton = event.target.closest('[data-reschedule]');
  if (rescheduleButton) openReschedule(rescheduleButton.dataset.reschedule);
  if (cancelButton) {
    try {
      await cancelAppointment(cancelButton.dataset.cancel);
    } catch (err) {
      showMessage(friendlyError(err), 'error');
    }
  }
});

els.messagesList.addEventListener('click', async event => {
  const statusButton = event.target.closest('[data-message-status]');
  const deleteButton = event.target.closest('[data-message-delete]');
  try {
    if (statusButton) await updateMessageStatus(statusButton.dataset.messageStatus, statusButton.dataset.status);
    if (deleteButton) await deleteMessage(deleteButton.dataset.messageDelete);
  } catch (err) {
    showMessage(friendlyError(err), 'error');
  }
});

els.registerPhoneNumber.addEventListener('click', () => registerSelectedPhoneNumber().catch(err => showPhoneProvisioningMessage(err)));
els.exportCsv.addEventListener('click', () => exportAppointmentsCsv().catch(err => showMessage(friendlyError(err), 'error')));
els.backupNow.addEventListener('click', () => createBackupNow().catch(err => showBackupMessage(friendlyError(err), 'error')));
els.availablePhoneForm.addEventListener('submit', event => {
  event.preventDefault();
  searchAvailablePhoneNumbers().catch(err => showPhoneProvisioningMessage(err));
});
els.availablePhoneResults.addEventListener('click', event => {
  const button = event.target.closest('[data-provision-phone]');
  if (button) provisionPhoneNumber(button.dataset.provisionPhone).catch(err => showPhoneProvisioningMessage(err));
});

els.bookingForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        name: els.bookingName.value,
        phone: els.bookingPhone.value,
        reason: els.bookingReason.value,
        start: els.bookingStart.value,
      }),
    });
    els.dialog.close();
    showMessage('Appointment booked.');
    await loadAll();
  } catch (err) {
    showMessage(friendlyError(err), 'error');
  }
});
els.closeDialog.addEventListener('click', () => els.dialog.close());
els.cancelBooking.addEventListener('click', () => els.dialog.close());
els.rescheduleForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api(`/api/appointments/${els.rescheduleId.value}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({
        date: els.rescheduleDate.value,
        time: els.rescheduleTime.value,
      }),
    });
    els.rescheduleDialog.close();
    showMessage('Appointment rescheduled.');
    await loadAll();
  } catch (err) {
    showMessage(friendlyError(err), 'error');
  }
});
els.closeReschedule.addEventListener('click', () => els.rescheduleDialog.close());
els.cancelReschedule.addEventListener('click', () => els.rescheduleDialog.close());
els.messageFilter.addEventListener('change', () => loadAll().catch(err => showMessage(friendlyError(err), 'error')));
els.dismissAuthBanner.addEventListener('click', () => { els.authBanner.hidden = true; });
els.businessConfigForm.addEventListener('submit', event => {
  event.preventDefault();
  saveBusinessConfig().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.voiceConfigForm.addEventListener('submit', event => {
  event.preventDefault();
  saveVoiceConfig().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.aiUnderstandingForm.addEventListener('submit', event => {
  event.preventDefault();
  saveAiConfig().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.recoveryPhoneForm.addEventListener('submit', event => {
  event.preventDefault();
  saveRecoveryPhone().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.recoveryEmailForm.addEventListener('submit', event => {
  event.preventDefault();
  saveRecoveryEmail().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.testEmailConfig.addEventListener('click', () => testEmailConfig().catch(err => renderNotice(els.emailTestResult, { ok: false, error: friendlyError(err) })));
els.emailConfigForm.addEventListener('submit', event => {
  event.preventDefault();
  saveEmailConfig().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
els.adminPasswordForm.addEventListener('submit', event => {
  event.preventDefault();
  changeAdminPassword().catch(err => showConfigMessage(friendlyError(err), 'error'));
});
if (els.logoutButton) els.logoutButton.addEventListener('click', () => logout());
if (els.accountLogoutButton) els.accountLogoutButton.addEventListener('click', () => logout());

initialize();
setInterval(() => {
  api('/api/messages/unread-count').then(({ count }) => {
    state.unreadCount = count || 0;
    renderMessages();
  }).catch(() => {});
}, 20000);

// --- Theme toggle (light/dark) ---------------------------------------------
(function () {
  var toggle = document.querySelector('#theme-toggle');
  if (!toggle) return;
  function syncLabel() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    toggle.textContent = dark ? '\u2600\uFE0F Light' : '\uD83C\uDF19 Dark';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  syncLabel();
  toggle.addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) { /* ignore */ }
    syncLabel();
  });
})();

// --- Hash-routed views (Schedule / Settings / Account) ---------------------
(function () {
  var views = {
    schedule: document.querySelector('#view-schedule'),
    settings: document.querySelector('#view-settings'),
    account: document.querySelector('#view-account'),
  };
  if (!views.schedule) return;
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));

  function maskPhone(value) {
    if (!value) return '';
    var d = String(value).replace(/\s+/g, '');
    return d.length <= 4 ? d : d.slice(0, 2) + '\u2022\u2022\u2022\u2022' + d.slice(-2);
  }
  function maskEmail(value) {
    if (!value) return '';
    var parts = String(value).split('@');
    if (parts.length !== 2) return value;
    var user = parts[0];
    var shown = user.length <= 2 ? (user[0] || '') : user.slice(0, 2);
    return shown + '\u2022\u2022\u2022@' + parts[1];
  }

  function renderAccount() {
    var c = (typeof state !== 'undefined' && state.config) ? state.config : {};
    var s = (typeof state !== 'undefined' && state.setupStatus) ? state.setupStatus : {};
    var p = (typeof state !== 'undefined' && state.phone) ? state.phone : {};
    var cal = (typeof state !== 'undefined' && state.calendar) ? state.calendar : {};
    var loginEmail = '';
    try { loginEmail = localStorage.getItem('authEmail') || ''; } catch (e) { loginEmail = ''; }
    function set(id, val) {
      var el = document.querySelector('#' + id);
      if (el) el.textContent = (val === undefined || val === null || val === '') ? '\u2014' : val;
    }
    set('account-business', c.businessName || s.businessName);
    set('account-admin', loginEmail || c.adminUser || '—');
    set('account-phone', p.activeNumber || p.phoneNumber || p.assignedNumber || c.smsFromNumber || 'Not assigned');
    var voiceLabel = c.voiceName;
    if (Array.isArray(c.voiceOptions) && c.voiceName) {
      var opt = c.voiceOptions.filter(function (v) { return v && v.name === c.voiceName; })[0];
      if (opt) voiceLabel = opt.label || opt.name;
    }
    set('account-voice', voiceLabel);
    var ai = c.aiUnderstanding || {};
    set('account-ai', ai.enabled ? ('On \u2014 ' + (ai.model || 'configured')) : 'Off \u2014 rule-based understanding');
    set('account-calendar', cal.url || cal.path || (cal.error ? 'Unavailable' : ''));
    set('account-recovery-phone', maskPhone(c.recoveryPhone) || 'Not set');
    set('account-recovery-email', maskEmail(c.recoveryEmail) || 'Not set');
    set('account-email', c.emailConfigured ? 'Configured' : 'Not configured');
    set('account-url', s.publicBaseUrl || (window.location ? window.location.origin : ''));
  }
  window.renderAccount = renderAccount;

  function current() {
    var name = (location.hash || '').replace(/^#\/?/, '').trim();
    return views[name] ? name : 'schedule';
  }
  function show(name) {
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });
    links.forEach(function (a) {
      var isActive = a.getAttribute('data-view') === name;
      a.classList.toggle('active', isActive);
      a.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    if (name === 'account') renderAccount();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', function () { show(current()); });
  show(current());
})();
