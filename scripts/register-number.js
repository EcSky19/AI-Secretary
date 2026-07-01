'use strict';

const twilioNumbers = require('../src/twilio-numbers');

function usage() {
  console.log(`Usage:
  node scripts/register-number.js --list
  node scripts/register-number.js --number +15551234567
  node scripts/register-number.js --sid PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  node scripts/register-number.js --search --area 415
  node scripts/register-number.js --buy +15551234567

Environment:
  Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and PUBLIC_BASE_URL in .env.
  PUBLIC_BASE_URL must be the public HTTPS base URL for this server.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--search') args.search = true;
    else if (arg === '--area') args.area = argv[++i];
    else if (arg === '--number') args.number = argv[++i];
    else if (arg === '--sid') args.sid = argv[++i];
    else if (arg === '--buy') args.buy = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args.invalid = arg;
  }
  return args;
}

function printNumbers(numbers) {
  if (!numbers.length) {
    console.log('No owned Twilio numbers found.');
    return;
  }
  for (const n of numbers) {
    console.log(`${n.sid}\t${n.phoneNumber}\tregistered=${Boolean(n.registered)}`);
  }
}

function printAvailable(numbers) {
  if (!numbers.length) {
    console.log('No available numbers found for that search.');
    return;
  }
  for (const n of numbers) {
    const location = [n.locality, n.region].filter(Boolean).join(', ');
    console.log(`${n.phoneNumber}\t${n.friendlyName || ''}\t${location}`);
  }
}

function friendlyError(err) {
  if (err.code === 'TWILIO_NOT_CONFIGURED') {
    return 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and PUBLIC_BASE_URL in .env, then try again.';
  }
  if (err.code === 'INVALID_INPUT') {
    return `Invalid input: ${err.message}`;
  }
  if (err.code === 'NUMBER_NOT_FOUND') {
    return `Number not found: ${err.message}`;
  }
  return err.message || 'Unexpected error.';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || process.argv.length <= 2) {
    usage();
    process.exitCode = 0;
    return;
  }

  if (args.invalid) {
    console.error(`Invalid argument: ${args.invalid}`);
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    if (args.list) {
      printNumbers(await twilioNumbers.listNumbers());
      return;
    }

    if (args.search) {
      if (!args.area) {
        console.error('Missing required --area value for --search.');
        usage();
        process.exitCode = 1;
        return;
      }
      printAvailable(await twilioNumbers.searchAvailable({ areaCode: args.area }));
      return;
    }

    if (args.buy) {
      console.log('Purchasing a Twilio phone number may incur charges on your Twilio account.');
      const result = await twilioNumbers.purchaseNumber({ phoneNumber: args.buy });
      console.log('Purchased and registered number:');
      console.log(JSON.stringify(result, null, 2));
      console.log(`Voice webhook URL: ${twilioNumbers.getVoiceWebhookUrl()}`);
      return;
    }

    if (args.number || args.sid) {
      const result = await twilioNumbers.registerNumber({
        phoneNumber: args.number,
        sid: args.sid,
      });
      console.log('Registered number:');
      console.log(JSON.stringify(result, null, 2));
      console.log(`Voice webhook URL: ${twilioNumbers.getVoiceWebhookUrl()}`);
      return;
    }

    usage();
    process.exitCode = 1;
  } catch (err) {
    console.error(friendlyError(err));
    process.exitCode = 1;
  }
}

main();
