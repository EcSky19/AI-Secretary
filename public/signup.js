'use strict';

const els = {
  form: document.querySelector('#signup-form'),
  businessName: document.querySelector('#signup-business-name'),
  email: document.querySelector('#signup-email'),
  password: document.querySelector('#signup-password'),
  confirm: document.querySelector('#signup-confirm'),
  message: document.querySelector('#auth-message'),
  submit: document.querySelector('#signup-submit'),
};

function showMessage(text, type = 'error') {
  els.message.textContent = text;
  els.message.className = `message show ${type}`;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return data;
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = els.password.value;
  if (password !== els.confirm.value) {
    showMessage('Passwords do not match.');
    return;
  }
  els.submit.disabled = true;
  els.submit.textContent = 'Creating account…';
  try {
    const email = els.email.value.trim().toLowerCase();
    const result = await postJson('/api/auth/signup', {
      businessName: els.businessName.value.trim(),
      email,
      password,
    });
    try { localStorage.setItem('authEmail', (result.user && result.user.email) || email); } catch (e) { /* ignore */ }
    window.location.replace('/');
  } catch (err) {
    if (err.status === 409) showMessage('An account already exists for that email. Try signing in.');
    else showMessage(err.message);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Create account';
  }
});

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
