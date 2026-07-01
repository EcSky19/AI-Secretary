'use strict';

const config = require('../src/config');
const twilioNumbers = require('../src/twilio-numbers');

const output = {
  PORT: config.port,
  PUBLIC_BASE_URL: config.publicBaseUrl,
  VOICE_WEBHOOK_URL: twilioNumbers.getVoiceWebhookUrl(),
  TWILIO_CONFIGURED: twilioNumbers.isConfigured(),
  OPENAI_CONFIGURED: Boolean(config.openai.apiKey),
  DATABASE_PATH: config.databasePath,
};

console.log(JSON.stringify(output, null, 2));
