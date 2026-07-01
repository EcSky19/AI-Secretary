'use strict';

const els = {
  form: document.querySelector('#login-form'),
  email: document.querySelector('#login-email'),
  password: document.querySelector('#login-password'),
  message: document.querySelector('#auth-message'),
  submit: document.querySelector('#login-submit'),
};

function nextPath() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

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
    const err = new Error(data.error || (response.status === 401 ? 'Email or password is incorrect.' : `Request failed (${response.status})`));
    err.status = response.status;
    throw err;
  }
  return data;
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  els.submit.disabled = true;
  els.submit.textContent = 'Signing in…';
  try {
    const email = els.email.value.trim().toLowerCase();
    const result = await postJson('/api/auth/login', {
      email,
      password: els.password.value,
    });
    try { localStorage.setItem('authEmail', (result.user && result.user.email) || email); } catch (e) { /* ignore */ }
    window.location.replace(nextPath());
  } catch (err) {
    showMessage(err.status === 401 ? 'Email or password is incorrect.' : err.message);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Sign in';
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
