'use strict';

const setupState = {
  config: null,
  phone: null,
  availableNumbers: [],
};

const els = {
  message: document.querySelector('#setup-message'),
  businessCopy: document.querySelector('#setup-business-copy'),
  phonePanel: document.querySelector('#setup-phone-panel'),
  searchForm: document.querySelector('#setup-search-form'),
  areaCode: document.querySelector('#setup-area-code'),
  contains: document.querySelector('#setup-contains'),
  availableResults: document.querySelector('#setup-available-results'),
  ownedPhoneNumber: document.querySelector('#setup-owned-phone-number'),
  registerOwned: document.querySelector('#setup-register-owned'),
  logout: document.querySelector('#setup-logout'),
};

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
    if (response.status === 401) {
      window.location.replace(`/login.html?next=${encodeURIComponent('/setup.html')}`);
    }
    const responseError = typeof data.error === 'string' ? data.error : (data.error && data.error.message);
    const err = new Error(responseError || `Request failed (${response.status})`);
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
  showMessage.timer = setTimeout(() => { els.message.className = 'message'; }, 7000);
}

function showProvisioningUnavailable(resultOrError) {
  const error = resultOrError && resultOrError.error;
  const message = typeof error === 'string'
    ? error
    : (error && error.message) || (resultOrError && resultOrError.message);
  showMessage(
    message || 'Number provisioning is not available yet. You can manage your schedule and try again later.',
    'error'
  );
}

function activeNumber() {
  const phone = setupState.phone || {};
  return phone.activeNumber || phone.phoneNumber || phone.assignedNumber || (setupState.config && setupState.config.smsFromNumber) || '';
}

function renderPhone() {
  const phone = setupState.phone || {};
  const number = activeNumber();
  els.phonePanel.innerHTML = `
    <div class="phone-summary">
      <div>
        <div class="muted">Clients should call</div>
        <div class="phone-number-display">${escapeHtml(number || 'Not set')}</div>
      </div>
      <div class="phone-detail"><strong>Voice webhook:</strong> ${escapeHtml(phone.webhookUrl || 'Managed by the platform')}</div>
      <div><span class="badge">${number ? 'Assigned' : 'Not assigned'}</span></div>
    </div>
    ${number ? '<div class="notice good">Your phone number is assigned.</div>' : '<div class="notice info">Search for a new number or assign an existing platform number below.</div>'}
    ${phone.configured === false ? '<div class="notice warn">Number provisioning is not available yet. Try again later or continue to the dashboard.</div>' : ''}
    ${phone.error ? `<div class="notice error">${escapeHtml(phone.error)}</div>` : ''}
  `;
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
          <span>${escapeHtml(number.friendlyName) || 'Phone number'}</span>
          <span>${escapeHtml([number.locality, number.region].filter(Boolean).join(', '))}</span>
        </div>
      </div>
      <button class="primary" data-provision-phone="${escapeHtml(number.phoneNumber)}">Claim number</button>
    </article>
  `).join('');
}

async function loadPhone() {
  setupState.config = await api('/api/config');
  if (els.businessCopy) {
    els.businessCopy.textContent = `${setupState.config.businessName || 'Your business'} can get a number now or skip this step and manage the schedule first.`;
  }
  try {
    setupState.phone = await api('/api/phone');
  } catch (err) {
    setupState.phone = {
      configured: false,
      activeNumber: setupState.config.smsFromNumber || '',
      error: err.status === 503 ? 'Number provisioning is not available yet.' : err.message,
    };
  }
  renderPhone();
}

async function searchAvailableNumbers() {
  const params = new URLSearchParams();
  if (els.areaCode.value.trim()) params.set('areaCode', els.areaCode.value.trim());
  if (els.contains.value.trim()) params.set('contains', els.contains.value.trim());
  const data = await api(`/api/phone/available${params.toString() ? `?${params.toString()}` : ''}`);
  if (data.ok === false) {
    setupState.availableNumbers = [];
    renderAvailableNumbers();
    showProvisioningUnavailable(data);
    return;
  }
  setupState.availableNumbers = Array.isArray(data) ? data : (Array.isArray(data.numbers) ? data.numbers : []);
  renderAvailableNumbers();
}

async function provisionNumber(phoneNumber) {
  if (!confirm(`Claim ${phoneNumber} for this business?`)) return;
  const body = { phoneNumber };
  if (els.areaCode.value.trim()) body.areaCode = els.areaCode.value.trim();
  if (els.contains.value.trim()) body.contains = els.contains.value.trim();
  const result = await api('/api/phone/provision', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (result.ok === false) {
    showProvisioningUnavailable(result);
    return;
  }
  setupState.availableNumbers = [];
  renderAvailableNumbers();
  showMessage('Phone number claimed and assigned.');
  await loadPhone();
}

async function registerOwnedNumber() {
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
    showProvisioningUnavailable(result);
    return;
  }
  els.ownedPhoneNumber.value = '';
  showMessage('Phone number assigned.');
  await loadPhone();
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    try { localStorage.removeItem('authEmail'); } catch (e) { /* ignore */ }
    window.location.replace('/login.html');
  }
}

els.searchForm.addEventListener('submit', event => {
  event.preventDefault();
  searchAvailableNumbers().catch(err => showProvisioningUnavailable(err));
});
els.availableResults.addEventListener('click', event => {
  const button = event.target.closest('[data-provision-phone]');
  if (button) provisionNumber(button.dataset.provisionPhone).catch(err => showProvisioningUnavailable(err));
});
els.registerOwned.addEventListener('click', () => registerOwnedNumber().catch(err => showProvisioningUnavailable(err)));
els.logout.addEventListener('click', () => logout());

loadPhone().catch(err => showProvisioningUnavailable(err));

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
    if (dark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) { /* ignore */ }
    syncLabel();
  });
})();
