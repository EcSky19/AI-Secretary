# AI Secretary

AI Secretary is a phone-scheduling app for non-technical trade businesses such as plumbers, mechanics, cleaners, electricians, HVAC shops, and other appointment-based local services. It answers calls with Twilio, helps customers book or change appointments, and gives the owner a browser dashboard.

## What it does

- AI phone answering for real business calls.
- Natural-sounding neural assistant voice (Amazon Polly Neural), selectable in the dashboard.
- Voice booking, rescheduling, cancelling, and message-taking.
- Browser dashboard for appointments, settings, messages, backups, and CSV exports.
- SMS confirmations, cancellation notices, and appointment reminders.
- Open-days and blackout-date controls for days you are closed.
- iCal calendar feed for Google, Apple, and Outlook calendars.
- Admin login protection, plus self-service password reset by text message or email and a recovery script for forgotten passwords.
- In-browser first-run setup wizard for business hours, login, Twilio, and phone number setup.
- SQLite-backed schedule storage using built-in `node:sqlite`.
- Automatic and manual database backups.
- Security headers and rate limiting for public routes.
- Rule-based conversation fallback when OpenAI is not configured.

## Deploy for a real business

For the easiest no-command-line setup, use the Render Blueprint included in this repo:

**Read [DEPLOYMENT.md](DEPLOYMENT.md), then follow “Fastest way (recommended): deploy to the cloud with Render.”**

The short version is: connect this GitHub repo to Render, let Render read `render.yaml`, deploy, open the public URL, and complete the setup wizard in your browser. The Render config includes a persistent disk so appointments and backups survive restarts.

Fly.io (`fly.toml`) and Railway (`railway.json`) configs are also included for technical users. Render remains the recommended path for most owners.

## Requirements for developers

- Node.js >= 22.5.0 for built-in `node:sqlite` support.
- npm.
- A public HTTPS URL for real Twilio calls.
- A Twilio account for real phone calls and SMS.
- An OpenAI API key is optional.

## Run locally

```powershell
cd C:\Users\t-ecoskay\secretary\AI-Secretary
Copy-Item .env.example .env
npm install
npm start
```

The server starts on `http://localhost:3000`. Localhost is fine for trying the dashboard, but real Twilio calls need a public HTTPS host or a tunnel such as ngrok. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Environment variables

Most owners can use the browser setup wizard instead of editing environment variables. Copy `.env.example` to `.env` only for local development or technical overrides.

| Variable | Description | Default/example |
| --- | --- | --- |
| `PORT` | Local Express port. | `3000` |
| `PUBLIC_BASE_URL` | Public URL used for Twilio webhook configuration when the host cannot auto-detect it. | `http://localhost:3000` |
| `BUSINESS_HOURS_START` | Default opening time in 24-hour local time. | `09:00` |
| `BUSINESS_HOURS_END` | Default closing time in 24-hour local time. | `17:00` |
| `APPOINTMENT_LENGTH_MINUTES` | Default appointment length. | `30` |
| `TIMEZONE` | Display/reference timezone. Scheduling stores naive local strings. | `America/Los_Angeles` |
| `OPENAI_API_KEY` | Optional OpenAI key. Leave blank for rule-based fallback. | blank |
| `OPENAI_MODEL` | OpenAI model name when OpenAI is enabled. | `gpt-4o-mini` |
| `TWILIO_ACCOUNT_SID` | Optional Twilio account SID override. Usually entered in the setup wizard. | blank |
| `TWILIO_AUTH_TOKEN` | Optional Twilio auth token override. Usually entered in the setup wizard. | blank |
| `TWILIO_PHONE_NUMBER` | Optional Twilio phone number override. Usually selected in the setup wizard. | blank |
| `TWILIO_VALIDATE_SIGNATURE` | Validate Twilio webhook signatures. Keep `true` in production. | `true` |
| `ADMIN_USER` | HTTP Basic auth user when admin auth is enabled. | `admin` |
| `ADMIN_PASSWORD` | Optional admin password override. Usually created in the setup wizard. | blank |
| `ADMIN_TOKEN` | Optional bearer token / calendar token override. | blank |
| `REMINDERS_ENABLED` | Enable automatic SMS appointment reminders. | `true` |
| `REMINDER_LEAD_MINUTES` | Default minutes before an appointment to send reminders. | `60` |
| `REMINDER_POLL_SECONDS` | Reminder worker polling interval. | `60` |
| `DATABASE_PATH` | SQLite database file path. Use persistent storage in production. | `./data/secretary.db` |
| `BACKUPS_ENABLED` | Enable automatic database backups. | `true` |
| `BACKUP_INTERVAL_HOURS` | Hours between automatic backups. | `24` |
| `BACKUP_KEEP` | Number of newest backup files to keep. | `14` |
| `BACKUP_DIR` | Backup folder. Defaults to `<data dir>/backups`. | blank |
| `RATE_LIMIT_ENABLED` | Enable rate limiting on public setup and voice webhook routes. | `true` |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window length. | `60000` |
| `RATE_LIMIT_MAX` | Requests allowed per window per client. | `120` |

## Architecture

- `server.js` creates the Express app, serves `public/`, and mounts routers.
- `src/db.js` owns SQLite setup, settings, appointment CRUD, overlap checks, rescheduling, cancellation, and messages.
- `src/scheduling.js` contains time helpers, speech formatting, and availability generation.
- `src/api.js` exposes the REST API under `/api` for settings, appointments, availability, messages, phone number registration, CSV export, and backups.
- `src/voice.js` exposes Twilio Voice webhooks under `/voice`.
- `src/notify.js` sends SMS notifications when Twilio SMS credentials are configured.
- `src/backups.js` creates consistent SQLite snapshots with `VACUUM INTO` and restores selected backup files.
- `src/runtime-config.js` stores owner-entered business, Twilio, and admin settings in the database.
- `src/security.js` adds security headers and rate limiting.
- `public/` contains the browser UI for setup, schedule management, messages, phone number setup, settings, backups, and exports.

Times are stored as naive local wall-clock strings: `YYYY-MM-DDTHH:mm`.

## Backups and restore

AI Secretary stores appointments, messages, settings, Twilio setup, and the admin password hash in one SQLite database. Automatic backups make timestamped copies using SQLite `VACUUM INTO`, which creates consistent snapshots.

- Backups are stored in `<data dir>/backups` by default, or in `BACKUP_DIR` when set.
- Automatic backups use `BACKUPS_ENABLED`, `BACKUP_INTERVAL_HOURS`, and `BACKUP_KEEP`.
- The dashboard has a Backups panel to view backups and create one manually.
- Authenticated API endpoints: `GET /api/backups` lists backups and `POST /api/backups` creates one.
- On cloud hosts, put both the database and backups folder on persistent disk storage.

Manual backup:

```powershell
node scripts/backup.js
```

Restore from a backup:

```powershell
node scripts/restore.js
node scripts/restore.js secretary-YYYYMMDD-HHMMSS.db
```

Run `node scripts/restore.js` without a file name to list available backups. To restore safely, stop the app, run the restore command, then restart the app. Restoring overwrites the current live database.

## Admin lockout recovery

Two ways to recover a forgotten dashboard password:

**1. Self-service reset by text message or email (no technical access needed).**
If a recovery contact is on file, the owner can reset their own password from the
browser:

1. Go to `/forgot.html` (a "Forgot password?" link is on the setup page).
2. Choose how to receive the code — **text message** (needs a recovery phone + Twilio SMS) or **email** (needs a recovery email + email/SMTP connected).
3. A 6-digit code is sent to that contact.
4. Enter the code and a new password.

Codes are single-use, expire after 10 minutes, and are rate-limited. Set or update
the recovery phone, recovery email, and email (SMTP) connection any time from the
dashboard's **Settings**, or during first-run setup. This flow is disabled when the
password is pinned via the `ADMIN_PASSWORD` environment variable (change that
variable instead).

**2. Command-line reset (for hosts with server/terminal access).**
Use this when text-message reset is unavailable (no recovery number or SMS not connected):

```powershell
node scripts/reset-admin.js newpass1
node scripts/reset-admin.js --user owner newpass1
```

Passwords must be at least 6 characters. Restart the app afterward if it is already running. These scripts are run directly with `node` because `package.json` aliases are intentionally unchanged; technical users can add npm aliases if they want.

## Calendar subscription

Booked appointments are available as an iCal feed at:

```text
http://localhost:3000/calendar.ics
```

Use the dashboard's Subscribe / Export Calendar link, or paste the URL into Google, Apple, or Outlook calendar. If `ADMIN_TOKEN` is configured, use `/calendar.ics?token=<ADMIN_TOKEN>` for calendar apps that cannot send custom headers.

## CSV export

Owners can download appointment records from the dashboard Export button, or from this authenticated endpoint:

```text
GET /api/appointments/export.csv?status=all|booked|cancelled&from=&to=
```

Use it for record keeping or importing appointments into spreadsheets.

## Security

Security headers are always added to responses. Rate limiting protects the public setup and Twilio voice webhook routes with `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX`. Keep the defaults unless you have a specific operational reason to change them.

## REST API reference

Authenticated dashboard/API routes require the configured admin login or token when admin protection is active.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/settings` | Get business hours, appointment length, open days, blackout dates, and reminder lead time. |
| `PUT` | `/api/settings` | Update `appointmentLengthMinutes`, `businessHoursStart`, `businessHoursEnd`, `openDays`, `blackoutDates`, and `reminderLeadMinutes`. |
| `GET` | `/api/appointments?status=&from=&to=` | List appointments, optionally filtered by status and time range. |
| `GET` | `/api/appointments/export.csv?status=all\|booked\|cancelled&from=&to=` | Download appointments as CSV. |
| `POST` | `/api/appointments` | Book an appointment with `{ name, phone, reason, date, time }` or `{ name, start }`. |
| `PATCH` | `/api/appointments/:id/reschedule` | Reschedule a booked appointment. |
| `PATCH` | `/api/appointments/:id` | Alternate reschedule endpoint. |
| `DELETE` | `/api/appointments/:id` | Cancel an appointment. |
| `GET` | `/api/availability?date=YYYY-MM-DD` | List available slots for a date. |
| `GET` | `/calendar.ics` | iCal feed of booked appointments. |
| `GET` | `/api/messages?status=new\|read\|all` | List phone messages. |
| `GET` | `/api/messages/unread-count` | Return `{ count }` for new messages. |
| `POST` | `/api/messages` | Create a phone message. |
| `PATCH` | `/api/messages/:id` | Update a message status. |
| `DELETE` | `/api/messages/:id` | Delete a phone message. |
| `GET` | `/api/phone` | Get Twilio phone setup status, webhook URL, active number, and registration state. |
| `GET` | `/api/phone/numbers` | List owned Twilio numbers. |
| `POST` | `/api/phone/register` | Register an owned Twilio number. |
| `GET` | `/api/phone/available?areaCode=415` | Search available Twilio numbers to buy. |
| `POST` | `/api/phone/provision` | Buy and register a Twilio number. |
| `GET` | `/api/backups` | List database backups. |
| `POST` | `/api/backups` | Create a database backup now. |

## Phone number setup

Use the setup wizard or dashboard Phone Number panel to connect Twilio, register an existing number, search for available numbers, or buy and register a new number. Technical users can also run:

```powershell
npm run register-number -- --list
npm run register-number -- --number +15551234567
npm run register-number -- --search --area 415
npm run register-number -- --buy +15551234567
```

Twilio credentials must never be committed. `PUBLIC_BASE_URL` must be a public HTTPS URL for real calls; `localhost` is only useful for local testing with a tunnel.

## Testing

```powershell
npm test
```

To run only the database and scheduling tests:

```powershell
node --test test\db.test.js
```
