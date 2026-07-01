# AI Secretary

AI Secretary is a Node.js and Express app that answers phone calls through Twilio Voice, helps callers book, reschedule, or cancel appointments, takes phone messages, and provides a web UI for viewing and managing the schedule.

## Features

- AI phone secretary for appointment booking, rescheduling, cancellation, and message-taking by voice.
- Twilio Voice webhooks for incoming calls.
- Optional SMS notifications for booked, rescheduled, cancelled, and reminder messages.
- Rule-based conversation fallback when OpenAI is not configured.
- Web UI to view upcoming appointments, subscribe/export calendar events, reschedule bookings, and manage the messages inbox.
- Phone Number panel to register the Twilio number clients should call.
- Settings UI and REST API for business hours, open days, blackout dates, appointment length, and reminder lead time.
- SQLite-backed schedule storage using built-in `node:sqlite`.

## Architecture

- `server.js` creates the Express app, serves `public/`, and mounts routers.
- `src/db.js` owns SQLite setup, settings, appointment CRUD, overlap checks, rescheduling, cancellation, and messages.
- `src/scheduling.js` contains time helpers, speech formatting, and availability generation.
- `src/api.js` exposes the REST API under `/api` for settings, appointments, availability, messages, and phone number registration.
- `src/voice.js` exposes Twilio Voice webhooks under `/voice`.
- `src/notify.js` sends SMS notifications when Twilio SMS credentials are configured.
- `public/` contains the browser UI for viewing the schedule, rescheduling appointments, managing messages, and updating settings.

Times are stored as naive local wall-clock strings: `YYYY-MM-DDTHH:mm`.

## Prerequisites

- Node.js >= 22.5.0 for built-in `node:sqlite` support.
- npm.
- A Twilio account is required only for real phone calls.
- An OpenAI API key is optional; without one, the app uses a rule-based fallback.

## Setup

```powershell
cd C:\Users\t-ecoskay\secretary\AI-Secretary
Copy-Item .env.example .env
npm install
npm run seed
npm start
```

The server starts on `http://localhost:3000` by default.

## Environment variables

Copy `.env.example` to `.env` and adjust values as needed.

| Variable | Description | Default/example |
| --- | --- | --- |
| `PORT` | Local Express port. | `3000` |
| `PUBLIC_BASE_URL` | Public URL used for Twilio webhook configuration. | `http://localhost:3000` |
| `BUSINESS_HOURS_START` | Default opening time in 24-hour local time. | `09:00` |
| `BUSINESS_HOURS_END` | Default closing time in 24-hour local time. | `17:00` |
| `APPOINTMENT_LENGTH_MINUTES` | Default appointment length. | `30` |
| `TIMEZONE` | Display/reference timezone. Scheduling stores naive local strings. | `America/Los_Angeles` |
| `OPENAI_API_KEY` | Optional OpenAI key. Leave blank for rule-based fallback. | blank |
| `OPENAI_MODEL` | OpenAI model name when OpenAI is enabled. | `gpt-4o-mini` |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for real calls. | blank |
| `TWILIO_AUTH_TOKEN` | Twilio auth token for real calls. | blank |
| `TWILIO_PHONE_NUMBER` | Twilio phone number used by the secretary for calls and optional SMS notifications. | blank |
| `TWILIO_VALIDATE_SIGNATURE` | Validate Twilio webhook signatures. Keep `true` in production; use `false` only for local testing without a public URL. | `true` |
| `ADMIN_USER` | HTTP Basic auth user when admin auth is enabled. | `admin` |
| `ADMIN_PASSWORD` | Enables admin HTTP Basic auth for `/api` when set. | blank |
| `ADMIN_TOKEN` | Enables Bearer token or `?token=` access for `/api` and tokenized calendar subscriptions. | blank |
| `REMINDERS_ENABLED` | Enable automatic SMS appointment reminders. | `true` |
| `REMINDER_LEAD_MINUTES` | Default minutes before an appointment to send reminders. The Settings UI can override this in the database. | `60` |
| `REMINDER_POLL_SECONDS` | Reminder worker polling interval. | `60` |
| `DATABASE_PATH` | SQLite database file path. | `./data/secretary.db` |

SMS notifications and reminders are optional. If any Twilio SMS credential is missing, notification helpers safely no-op and log what would have been sent so local development continues without Twilio.

## Admin authentication

By default, local `/api` access is open. Set `ADMIN_PASSWORD` to require HTTP Basic auth with `ADMIN_USER` (default `admin`), or set `ADMIN_TOKEN` to allow `Authorization: Bearer <token>` and `?token=<token>` access. The browser dashboard will show an authentication-required banner if protected API calls return `401`.

## Scheduling settings

The Settings UI and `/api/settings` support:

- `businessHoursStart` / `businessHoursEnd` in `HH:mm`.
- `appointmentLengthMinutes`.
- `openDays` as weekday indices (`0` Sunday through `6` Saturday).
- `blackoutDates` as `YYYY-MM-DD` dates when the business is closed.
- `reminderLeadMinutes`, the lead time for SMS reminders.

Closed weekdays and blackout dates return no available slots.

## Running tests

```powershell
npm test
```

The tests use Node's built-in `node:test` runner. Test files set `DATABASE_PATH` before requiring app modules so test data does not pollute the real database.

To run only the database and scheduling tests:

```powershell
node --test test\db.test.js
```

## Viewing the UI

Start the app and open:

```text
http://localhost:3000
```

The UI lets you view upcoming appointments, subscribe/export the calendar, reschedule or cancel bookings, review phone messages in the inbox, and update schedule settings such as appointment length, open days, blackout dates, and reminder lead time.

## Calendar subscription

Booked appointments are available as an iCal feed at:

```text
http://localhost:3000/calendar.ics
```

Use the web UI's Subscribe / Export Calendar link, or paste the URL into Google, Apple, or Outlook calendar. If `ADMIN_TOKEN` is configured, use `/calendar.ics?token=<ADMIN_TOKEN>` for calendar apps that cannot send custom headers.

## REST API reference

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/settings` | Get business hours, appointment length, open days, blackout dates, and reminder lead time. |
| `PUT` | `/api/settings` | Update `appointmentLengthMinutes`, `businessHoursStart`, `businessHoursEnd`, `openDays`, `blackoutDates`, and `reminderLeadMinutes`. |
| `GET` | `/api/appointments?status=&from=&to=` | List appointments, optionally filtered by status and time range. |
| `POST` | `/api/appointments` | Book an appointment with `{ name, phone, reason, date, time }` or `{ name, start }`. Returns `201`; overlapping slots return `409`. |
| `PATCH` | `/api/appointments/:id/reschedule` | Reschedule a booked appointment with `{ date, time }` or `{ start }`. Returns the updated row, `404`, or `409` with `nextAvailableSlots`. |
| `PATCH` | `/api/appointments/:id` | Alternate reschedule endpoint with the same request and response behavior. |
| `DELETE` | `/api/appointments/:id` | Cancel an appointment. Returns `{ ok: true }` or `404`. |
| `GET` | `/api/availability?date=YYYY-MM-DD` | List available slots for a date. |
| `GET` | `/calendar.ics` | iCal feed of booked appointments. Supports `?token=<ADMIN_TOKEN>` when a token is configured. |
| `GET` | `/api/messages?status=new\|read\|all` | List phone messages, newest first, optionally filtered by status. |
| `GET` | `/api/messages/unread-count` | Return `{ count }` for new messages. |
| `POST` | `/api/messages` | Create a phone message with `{ callerName, phone, body }`. Returns `201`. |
| `PATCH` | `/api/messages/:id` | Update a message status with `{ status: "new" }` or `{ status: "read" }`. |
| `DELETE` | `/api/messages/:id` | Delete a phone message. Returns `{ ok: true }` or `404`. |
| `GET` | `/api/phone` | Get Twilio phone setup status, webhook URL, active number, and registration state. Always returns `200`. |
| `GET` | `/api/phone/numbers` | List owned Twilio numbers and whether each points at this server. Returns `503` when Twilio is not configured. |
| `POST` | `/api/phone/register` | Register an owned Twilio number with `{ sid }` or `{ phoneNumber }` by setting its Voice webhook. Returns `503`, `400`, or `404` on setup/input errors. |
| `GET` | `/api/phone/available?areaCode=415` | Search available Twilio numbers to buy; also accepts `country`, `contains`, and `limit`. Returns `503` when Twilio is not configured. |
| `POST` | `/api/phone/provision` | Buy and register a Twilio number with `{ phoneNumber }`. Returns `201`, `503`, or `400`. |

Example booking request:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/appointments `
  -ContentType 'application/json' `
  -Body '{"name":"Ada Lovelace","phone":"+15551234567","reason":"Consultation","date":"2026-08-01","time":"09:00"}'
```

## Registering the phone number clients call

Registering a phone number points that Twilio number's Voice webhook at this server, so incoming calls reach the AI secretary at `{PUBLIC_BASE_URL}/voice/incoming`.

To use real calls, sign up for Twilio, set Twilio credentials in `.env`, start the app, and set `PUBLIC_BASE_URL` to a public HTTPS URL. For local testing, expose the app with a tunnel such as:

```powershell
ngrok http 3000
```

You can register a number three ways:

- In the web UI, use the Phone Number panel to view setup status, list owned numbers, register one, search available numbers, or buy and register a new number.
- From the command line:

  ```powershell
  npm run register-number -- --number +15551234567
  npm run register-number -- --list
  npm run register-number -- --search --area 415
  npm run register-number -- --buy +15551234567
  ```

- In the Twilio Console, open the number's Voice configuration and set the incoming call Voice webhook to `POST {PUBLIC_BASE_URL}/voice/incoming`.

Twilio credentials belong in `.env` and should never be committed. `PUBLIC_BASE_URL` must be a public HTTPS URL for real calls; `localhost` is only useful for local testing with a tunnel.

### Self-hosting / running outside this environment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, Docker Compose, and hosting options. The app can run anywhere Node.js is available, but Twilio must be able to reach a public HTTPS URL from ngrok, cloudflared, or your cloud host. Use `npm run config` to print the effective config and webhook URL before registering a number.

SMS notifications and OpenAI remain optional. If SMS credentials are missing, notifications no-op; if `OPENAI_API_KEY` is unset, the voice flow can use the rule-based fallback.

## OpenAI behavior

OpenAI is optional. If `OPENAI_API_KEY` is unset, the voice flow can use the built-in rule-based parser so local development and tests do not require an external AI service.
