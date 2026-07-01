'use strict';

const db = require('./db');

const DEFAULT_VOICE = 'Polly.Joanna-Neural';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function normalizeE164(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function resolveTenantByPhone(toNumber) {
  const phone = normalizeE164(toNumber);
  if (!phone) return null;
  return db.getTenantByPhone(phone);
}

function getDefaultTenantId() {
  return db.resolveDefaultTenantId();
}

function getTenantConfig(tenantId) {
  const id = db.resolveTenantId(tenantId);
  const tenant = db.getTenantById(id);
  if (!tenant) return null;
  const settings = db.getSettings(id);
  return {
    tenant,
    tenantId: id,
    businessName: tenant.business_name || db.getSetting(id, 'business_name') || 'AI Secretary',
    twilioPhoneNumber: tenant.twilio_phone_number || '',
    voiceName: db.getSetting(id, 'voice_name') || DEFAULT_VOICE,
    businessHoursStart: settings.businessHoursStart,
    businessHoursEnd: settings.businessHoursEnd,
    appointmentLengthMinutes: settings.appointmentLengthMinutes,
    openDays: settings.openDays,
    blackoutDates: settings.blackoutDates,
    reminderLeadMinutes: settings.reminderLeadMinutes,
    recoveryPhone: db.getSetting(id, 'recovery_phone') || '',
    recoveryEmail: db.getSetting(id, 'recovery_email') || '',
    email: {
      host: db.getSetting(id, 'smtp_host') || '',
      port: parseInt(db.getSetting(id, 'smtp_port'), 10) || 0,
      secure: db.getSetting(id, 'smtp_secure') === '1',
      user: db.getSetting(id, 'smtp_user') || '',
      pass: db.getSetting(id, 'smtp_pass') || '',
      from: db.getSetting(id, 'smtp_from') || '',
    },
    openai: {
      apiKey: db.getSetting(id, 'openai_api_key') || '',
      model: db.getSetting(id, 'openai_model') || DEFAULT_OPENAI_MODEL,
    },
  };
}

function getTenantSetting(tenantId, key) {
  return db.getSetting(db.resolveTenantId(tenantId), key);
}

function setTenantSetting(tenantId, key, value) {
  return db.setSetting(db.resolveTenantId(tenantId), key, value);
}

module.exports = {
  normalizeE164,
  resolveTenantByPhone,
  getDefaultTenantId,
  getTenantConfig,
  getTenantSetting,
  setTenantSetting,
};
