'use strict';

const runtimeConfig = require('../src/runtime-config');

function usage() {
  console.log(`Usage:
  node scripts/reset-admin.js [--user <name>] <newPassword>

Use this if the owner is locked out of the dashboard. Passwords must be at least 6 characters.`);
}

function parseArgs(argv) {
  const args = { positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--user') {
      args.user = argv[++i];
      if (!args.user) args.missingUser = true;
    } else if (arg.startsWith('--')) {
      args.invalid = arg;
    } else {
      args.positionals.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}

if (args.invalid) {
  console.error(`Invalid argument: ${args.invalid}`);
  usage();
  process.exit(1);
}

if (args.missingUser) {
  console.error('Missing value for --user.');
  usage();
  process.exit(1);
}

if (args.positionals.length !== 1) {
  console.error('Missing new password.');
  usage();
  process.exit(1);
}

const password = args.positionals[0];
if (password.length < 6) {
  console.error('Password must be at least 6 characters long.');
  process.exit(1);
}

try {
  const user = args.user || runtimeConfig.getAdminUser() || 'admin';
  runtimeConfig.setAdminCredentials({ user, password });
  console.log('Admin login updated successfully.');
  console.log(`User: ${user}`);
  console.log(`Password length: ${password.length} characters`);
  console.log('If the app is running, restart it before signing in again.');
  process.exit(0);
} catch (err) {
  console.error(`Admin reset failed: ${err.message || 'Unexpected error.'}`);
  process.exit(1);
}
