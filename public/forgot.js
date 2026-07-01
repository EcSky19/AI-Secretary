'use strict';

const resetState = {
  status: null,
  channel: 'sms',
};

const els = {
  message: document.querySelector('#reset-message'),
  unavailable: document.querySelector('#reset-unavailable'),
  unavailableCopy: document.querySelector('#reset-unavailable-copy'),
  unavailableHelp: document.querySelector('#reset-unavailable-help'),
  requestStep: document.querySelector('#request-step'),
  resetStep: document.querySelector('#reset-step'),
  successStep: document.querySelector('#success-step'),
  successCopy: document.querySelector('#success-copy'),
  requestTitle: document.querySelector('#request-step-title'),
  requestCopy: document.querySelector('#request-step-copy'),
  channelOptions: document.querySelector('#channel-options'),
  sendCode: document.querySelector('#send-code'),
  sendNewCode: document.querySelector('#send-new-code'),
  resetForm: document.querySelector('#reset-form'),
  resetCode: document.querySelector('#reset-code'),
  newPassword: document.querySelector('#new-password'),
  confirmPassword: document.querySelector('#confirm-password'),
  resetPassword: document.querySelector('#reset-password'),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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

function showMessage(text, type = 'success', persist = false) {
  els.message.textContent = text;
  els.message.className = `message show ${type}`;
  clearTimeout(showMessage.timer);
  if (!persist) showMessage.timer = setTimeout(() => { els.message.className = 'message'; }, 7000);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function hideAllSteps() {
  [els.unavailable, els.requestStep, els.resetStep, els.successStep].forEach(section => { section.hidden = true; });
}

function unavailableHelp(reason) {
  if (reason === 'env-managed') {
    return 'This password is controlled by the app hosting settings. Ask the person who manages the hosting account to update it there.';
  }
  if (reason === 'not-configured') {
    return 'It looks like setup is not finished yet. Open setup to create the first login.';
  }
  if (reason === 'no-recovery-phone' || reason === 'sms-unavailable') {
    return 'Ask whoever set up AI Secretary for help. If an admin is still signed in, they can add a recovery number or email under Settings.';
  }
  if (reason === 'no-recovery-email' || reason === 'email-unavailable' || reason === 'no-channel') {
    return 'Ask whoever set up AI Secretary for help. If an admin is still signed in, they can add a recovery email or connect email under Settings.';
  }
  return 'If you need help, ask the person who set up AI Secretary for this business.';
}

function showUnavailable(status) {
  hideAllSteps();
  els.unavailable.hidden = false;
  els.unavailableCopy.textContent = status.message || 'Password reset is not available right now.';
  els.unavailableHelp.textContent = unavailableHelp(status.reason);
  showMessage(status.message || 'Password reset is not available right now.', 'error', true);
}

function channelLabel(channel) {
  return channel === 'email' ? 'Email me a code' : 'Text me a code';
}

function channelHelper(channel, info) {
  if (!info || info.available) {
    return channel === 'email'
      ? 'Send the code to the recovery email on file.'
      : 'Send the code to the recovery phone on file.';
  }
  return info.message || (channel === 'email'
    ? 'Email reset is not available yet.'
    : 'Text reset is not available yet.');
}

function availableChannels(status) {
  const channels = status.channels || {};
  return ['sms', 'email'].filter(channel => channels[channel] && channels[channel].available);
}

function renderChannelOptions(status) {
  const channels = status.channels || {};
  const available = availableChannels(status);
  resetState.channel = available.includes(resetState.channel) ? resetState.channel : (available[0] || 'sms');
  if (available.length === 1) {
    const channel = available[0];
    const other = channel === 'sms' ? 'email' : 'sms';
    els.requestTitle.textContent = channel === 'email' ? 'Email me a reset code' : 'Text me a reset code';
    els.requestCopy.textContent = channel === 'email'
      ? 'We’ll email a 6-digit code to the recovery email on file. Keep this page open after you request it.'
      : 'We’ll text a 6-digit code to the recovery phone on file. Keep this page open after you request it.';
    els.sendCode.textContent = channel === 'email' ? 'Email me a reset code' : 'Text me a reset code';
    const otherInfo = channels[other];
    els.channelOptions.innerHTML = otherInfo && otherInfo.message
      ? `<legend>Other option</legend><p class="field-help">${escapeHtml(otherInfo.message)}</p>`
      : '';
    els.channelOptions.hidden = !els.channelOptions.innerHTML;
    return;
  }
  els.requestTitle.textContent = 'Send me a reset code';
  els.requestCopy.textContent = 'Choose where we should send your 6-digit code. Keep this page open after you request it.';
  els.sendCode.textContent = 'Send reset code';
  els.channelOptions.hidden = false;
  els.channelOptions.innerHTML = `
    <legend>Delivery method</legend>
    <div class="reset-channel-list">
      ${available.map(channel => `
        <label class="reset-channel-choice">
          <input type="radio" name="reset-channel" value="${channel}" ${channel === resetState.channel ? 'checked' : ''}>
          <span>
            <strong>${channelLabel(channel)}</strong>
            <span class="field-help">${escapeHtml(channelHelper(channel, channels[channel]))}</span>
          </span>
        </label>
      `).join('')}
    </div>
  `;
}

function showRequestStep() {
  hideAllSteps();
  els.requestStep.hidden = false;
  renderChannelOptions(resetState.status || {});
}

function showResetStep() {
  els.requestStep.hidden = true;
  els.resetStep.hidden = false;
  els.resetCode.focus();
}

function setButtonBusy(button, busyText, isBusy) {
  if (!button) return;
  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function resetErrorMessage(err) {
  const data = err.data || {};
  if (data.reason === 'cooldown' && data.retryAfter) {
    return `${err.message} You can try again in about ${data.retryAfter} seconds.`;
  }
  return err.message;
}

async function requestCode(button = els.sendCode) {
  const selectedChannel = els.channelOptions.querySelector('[name="reset-channel"]:checked');
  const channel = selectedChannel ? selectedChannel.value : resetState.channel;
  const channelInfo = resetState.status && resetState.status.channels && resetState.status.channels[channel];
  if (channelInfo && !channelInfo.available) {
    showMessage(channelInfo.message || 'That reset option is not available right now.', 'error');
    return;
  }
  resetState.channel = channel;
  setButtonBusy(button, 'Sending code…', true);
  try {
    const result = await api('/api/setup/forgot', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    });
    showMessage(result.message || 'We sent a reset code.');
    showResetStep();
  } catch (err) {
    showMessage(resetErrorMessage(err), 'error');
  } finally {
    setButtonBusy(button, '', false);
  }
}

async function resetPassword() {
  const code = els.resetCode.value.trim();
  const newPassword = els.newPassword.value;
  if (!/^\d{6}$/.test(code)) {
    showMessage('Enter the 6-digit code we sent you.', 'error');
    return;
  }
  if (newPassword !== els.confirmPassword.value) {
    showMessage('Passwords do not match.', 'error');
    return;
  }
  setButtonBusy(els.resetPassword, 'Updating…', true);
  try {
    const result = await api('/api/setup/reset', {
      method: 'POST',
      body: JSON.stringify({ code, newPassword }),
    });
    hideAllSteps();
    els.successStep.hidden = false;
    els.successCopy.textContent = result.message || 'Password updated. You can now sign in with your new password.';
    showMessage(result.message || 'Password updated. You can now sign in.', 'success', true);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setButtonBusy(els.resetPassword, '', false);
  }
}

async function initialize() {
  hideAllSteps();
  showMessage('Checking password reset options…', 'success');
  const status = await api('/api/setup/reset-status', { headers: {} });
  resetState.status = status;
  if (!status.available) {
    showUnavailable(status);
    return;
  }
  els.message.className = 'message';
  showRequestStep();
}

els.channelOptions.addEventListener('change', event => {
  const input = event.target.closest('[name="reset-channel"]');
  if (input) resetState.channel = input.value;
});
els.sendCode.addEventListener('click', () => requestCode().catch(err => showMessage(resetErrorMessage(err), 'error')));
els.sendNewCode.addEventListener('click', () => requestCode(els.sendNewCode).catch(err => showMessage(resetErrorMessage(err), 'error')));
els.resetForm.addEventListener('submit', event => {
  event.preventDefault();
  resetPassword().catch(err => showMessage(err.message, 'error'));
});

initialize().catch(err => showMessage(err.message, 'error', true));
