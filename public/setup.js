'use strict';

const setupState = {
  step: 1,
  profile: {},
  credentials: null,
  status: null,
  phoneNumbers: [],
  availableNumbers: [],
};

const els = {
  message: document.querySelector('#setup-message'),
  steps: [...document.querySelectorAll('[data-step]')],
  indicators: [...document.querySelectorAll('[data-step-indicator]')],
  businessForm: document.querySelector('#business-form'),
  businessName: document.querySelector('#setup-business-name'),
  businessStart: document.querySelector('#setup-business-start'),
  businessEnd: document.querySelector('#setup-business-end'),
  appointmentLength: document.querySelector('#setup-appointment-length'),
  loginForm: document.querySelector('#login-form'),
  adminUser: document.querySelector('#setup-admin-user'),
  adminPassword: document.querySelector('#setup-admin-password'),
  adminConfirm: document.querySelector('#setup-admin-confirm'),
  accountSid: document.querySelector('#setup-account-sid'),
  authToken: document.querySelector('#setup-auth-token'),
  phoneNumber: document.querySelector('#setup-phone-number'),
  twilioResult: document.querySelector('#setup-twilio-result'),
  testTwilio: document.querySelector('#setup-test-twilio'),
  saveTwilio: document.querySelector('#setup-save-twilio'),
  phonePicker: document.querySelector('#setup-phone-picker'),
  loadOwned: document.querySelector('#setup-load-owned'),
  ownedNumber: document.querySelector('#setup-owned-number'),
  registerOwned: document.querySelector('#setup-register-owned'),
  searchForm: document.querySelector('#setup-search-form'),
  areaCode: document.querySelector('#setup-area-code'),
  contains: document.querySelector('#setup-contains'),
  availableResults: document.querySelector('#setup-available-results'),
  skipPhone: document.querySelector('#skip-phone'),
  finishSetup: document.querySelector('#finish-setup'),
  localhostWarning: document.querySelector('#localhost-warning'),
  finishCopy: document.querySelector('#finish-copy'),
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function authHeader() {
  if (!setupState.credentials) return {};
  return { Authorization: `Basic ${btoa(`${setupState.credentials.user}:${setupState.credentials.password}`)}` };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showMessage(text, type = 'success') {
  els.message.textContent = text;
  els.message.className = `message show ${type}`;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { els.message.className = 'message'; }, 6000);
}

function showStep(step) {
  setupState.step = step;
  els.steps.forEach(section => { section.hidden = Number(section.dataset.step) !== step; });
  els.indicators.forEach(item => {
    const itemStep = Number(item.dataset.stepIndicator);
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('done', itemStep < step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderNotice(result) {
  els.twilioResult.hidden = false;
  if (result && result.ok) {
    els.twilioResult.className = 'notice good';
    els.twilioResult.textContent = `Connection works${result.friendlyName ? ` — ${result.friendlyName}` : ''}.`;
    els.phonePicker.hidden = false;
    return;
  }
  els.twilioResult.className = 'notice error';
  els.twilioResult.textContent = result && result.error ? result.error : 'Connection test failed.';
}

async function createProfile() {
  if (els.adminPassword.value !== els.adminConfirm.value) {
    showMessage('Passwords do not match.', 'error');
    return;
  }
  // Read the step-1 fields fresh from the DOM (they persist while hidden) so a
  // page reload or skipped capture can't submit an empty business profile.
  const businessName = (els.businessName.value || '').trim();
  if (!businessName) {
    showMessage('Please enter your business name to continue.', 'error');
    showStep(1);
    if (els.businessName.focus) els.businessName.focus();
    return;
  }
  setupState.profile = {
    businessName,
    businessHoursStart: els.businessStart.value,
    businessHoursEnd: els.businessEnd.value,
    appointmentLengthMinutes: Number(els.appointmentLength.value),
  };
  const user = els.adminUser.value.trim() || 'admin';
  const password = els.adminPassword.value;
  const body = {
    ...setupState.profile,
    adminUser: user,
    adminPassword: password,
  };
  const result = await api('/api/setup/profile', {
    method: 'POST',
    headers: {},
    body: JSON.stringify(body),
  });
  setupState.credentials = { user, password };
  sessionStorage.setItem('setupBasicUser', user);
  sessionStorage.setItem('setupBasicPassword', password);
  setupState.status = result.status;
  showMessage('Login created. You can connect a phone now or skip it for later.');
  showStep(3);
}

async function testTwilio() {
  const body = {};
  if (els.accountSid.value.trim()) body.accountSid = els.accountSid.value.trim();
  if (els.authToken.value.trim()) body.authToken = els.authToken.value;
  const result = await api('/api/config/twilio/test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  renderNotice(result);
}

async function saveTwilio() {
  const result = await api('/api/config/twilio', {
    method: 'PUT',
    body: JSON.stringify({
      accountSid: els.accountSid.value.trim(),
      authToken: els.authToken.value,
      phoneNumber: els.phoneNumber.value.trim(),
    }),
  });
  renderNotice(result.test || { ok: result.twilioConfigured });
  if (result.twilioConfigured) showMessage('Twilio saved. Now choose which number customers should call.');
  els.phonePicker.hidden = !result.twilioConfigured;
}

function renderOwnedNumbers() {
  if (!setupState.phoneNumbers.length) {
    els.ownedNumber.innerHTML = '<option value="">No owned numbers found</option>';
    return;
  }
  els.ownedNumber.innerHTML = setupState.phoneNumbers.map(number => {
    const label = `${number.phoneNumber || number.friendlyName || number.sid}${number.registered ? ' — registered' : ''}`;
    return `<option value="${escapeHtml(number.sid)}">${escapeHtml(label)}</option>`;
  }).join('');
}

async function loadOwnedNumbers() {
  setupState.phoneNumbers = await api('/api/phone/numbers');
  renderOwnedNumbers();
  showMessage('Owned phone numbers loaded.');
}

async function registerOwnedNumber() {
  const sid = els.ownedNumber.value;
  if (!sid) {
    showMessage('Choose a phone number first.', 'error');
    return;
  }
  await api('/api/phone/register', {
    method: 'POST',
    body: JSON.stringify({ sid }),
  });
  showMessage('Phone number registered.');
  await loadOwnedNumbers();
}

function renderAvailableNumbers() {
  if (!setupState.availableNumbers.length) {
    els.availableResults.innerHTML = '<div class="empty">No available numbers to show.</div>';
    return;
  }
  els.availableResults.innerHTML = setupState.availableNumbers.map(number => `
    <article class="list-item">
      <div>
        <div class="slot-title">${escapeHtml(number.phoneNumber)}</div>
        <div class="slot-meta">
          <span>${escapeHtml(number.friendlyName) || 'Twilio number'}</span>
          <span>${escapeHtml([number.locality, number.region].filter(Boolean).join(', '))}</span>
        </div>
      </div>
      <button class="primary" data-provision-phone="${escapeHtml(number.phoneNumber)}">Buy &amp; register</button>
    </article>
  `).join('');
}

async function searchAvailableNumbers() {
  const params = new URLSearchParams({ country: 'US', limit: '10' });
  if (els.areaCode.value.trim()) params.set('areaCode', els.areaCode.value.trim());
  if (els.contains.value.trim()) params.set('contains', els.contains.value.trim());
  setupState.availableNumbers = await api(`/api/phone/available?${params.toString()}`);
  renderAvailableNumbers();
}

async function provisionNumber(phoneNumber) {
  if (!confirm(`Buy ${phoneNumber} from Twilio and register it for incoming calls? This can incur Twilio charges.`)) return;
  await api('/api/phone/provision', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  });
  setupState.availableNumbers = [];
  renderAvailableNumbers();
  showMessage('Phone number purchased and registered.');
}

async function finish() {
  setupState.status = await api('/api/setup/status', { headers: {} });
  if (setupState.status.usingLocalhost) els.localhostWarning.hidden = false;
  if (setupState.status.businessName) els.finishCopy.textContent = `${setupState.status.businessName} is ready to manage appointments from the dashboard.`;
  showStep(4);
}

async function initialize() {
  const savedUser = sessionStorage.getItem('setupBasicUser');
  const savedPassword = sessionStorage.getItem('setupBasicPassword');
  if (savedUser && savedPassword) setupState.credentials = { user: savedUser, password: savedPassword };
  const status = await api('/api/setup/status', { headers: {} });
  setupState.status = status;
  if (status.setupComplete) {
    if (!setupState.credentials) {
      window.location.replace('/');
      return;
    }
    showMessage('Your login is already created. You can connect a phone now or finish setup.');
    showStep(3);
  }
  if (status.businessName) els.businessName.value = status.businessName;
}

els.businessForm.addEventListener('submit', event => {
  event.preventDefault();
  setupState.profile = {
    businessName: els.businessName.value.trim(),
    businessHoursStart: els.businessStart.value,
    businessHoursEnd: els.businessEnd.value,
    appointmentLengthMinutes: Number(els.appointmentLength.value),
  };
  showStep(2);
});
els.loginForm.addEventListener('submit', event => {
  event.preventDefault();
  createProfile().catch(err => showMessage(err.message, 'error'));
});
els.testTwilio.addEventListener('click', () => testTwilio().catch(err => renderNotice({ ok: false, error: err.message })));
els.saveTwilio.addEventListener('click', () => saveTwilio().catch(err => renderNotice({ ok: false, error: err.message })));
els.loadOwned.addEventListener('click', () => loadOwnedNumbers().catch(err => showMessage(err.message, 'error')));
els.registerOwned.addEventListener('click', () => registerOwnedNumber().catch(err => showMessage(err.message, 'error')));
els.searchForm.addEventListener('submit', event => {
  event.preventDefault();
  searchAvailableNumbers().catch(err => showMessage(err.message, 'error'));
});
els.availableResults.addEventListener('click', event => {
  const button = event.target.closest('[data-provision-phone]');
  if (button) provisionNumber(button.dataset.provisionPhone).catch(err => showMessage(err.message, 'error'));
});
els.skipPhone.addEventListener('click', () => finish().catch(err => showMessage(err.message, 'error')));
els.finishSetup.addEventListener('click', () => finish().catch(err => showMessage(err.message, 'error')));
document.addEventListener('click', event => {
  const button = event.target.closest('[data-back]');
  if (button) showStep(Number(button.dataset.back));
});

initialize().catch(err => showMessage(err.message, 'error'));
