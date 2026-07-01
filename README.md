# AI Secretary

AI Secretary is a phone-scheduling app for non-technical trade businesses such as plumbers, mechanics, cleaners, electricians, HVAC shops, and other appointment-based local services. It answers calls with Twilio, helps customers book or change appointments, and gives the owner a browser dashboard.

## What it does

- AI phone answering for real business calls.
- Voice booking, rescheduling, cancelling, and message-taking.
- Browser dashboard for appointments, settings, and messages.
- SMS confirmations, cancellation notices, and appointment reminders.
- Open-days and blackout-date controls for days you are closed.
- iCal calendar feed for Google, Apple, and Outlook calendars.
- Admin login protection.
- In-browser first-run setup wizard for business hours, login, Twilio, and phone number setup.
- SQLite-backed schedule storage using built-in `node:sqlite`.
- Rule-based conversation fallback when OpenAI is not configured.

## Deploy for a real business

For the easiest no-command-line setup, use the Render Blueprint included in this repo:

**Read [DEPLOYMENT.md](DEPLOYMENT.md), then follow “Fastest way (recommended): deploy to the cloud with Render.”**

The short version is: connect this GitHub repo to Render, let Render read `render.yaml`, deploy, open the public URL, and complete the setup wizard in your browser. The Render config includes a persistent disk so appointments survive restarts.

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

## Architecture

- `server.js` creates the Express app, serves `public/`, and mounts routers.
- `src/db.js` owns SQLite setup, settings, appointment CRUD, overlap checks, rescheduling, cancellation, and messages.
- `src/scheduling.js` contains time helpers, speech formatting, and availability generation.
- `src/api.js` exposes the REST API under `/api` for settings, appointments, availability, messages, and phone number registration.
- `src/voice.js` exposes Twilio Voice webhooks under `/voice`.
- `src/notify.js` sends SMS notifications when Twilio SMS credentials are configured.
- `public/` contains the browser UI for setup, schedule management, messages, phone number setup, and settings.

Times are stored as naive local wall-clock strings: `YYYY-MM-DDTHH:mm`.

## Calendar subscription

Booked appointments are available as an iCal feed at:

```text
http://localhost:3000/calendar.ics
```

Use the dashboard's Subscribe / Export Calendar link, or paste the URL into Google, Apple, or Outlook calendar. If `ADMIN_TOKEN` is configured, use `/calendar.ics?token=<ADMIN_TOKEN>` for calendar apps that cannot send custom headers.

## REST API reference

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/settings` | Get business hours, appointment length, open days, blackout dates, and reminder lead time. |
| `PUT` | `/api/settings` | Update `appointmentLengthMinutes`, `businessHoursStart`, `businessHoursEnd`, `openDays`, `blackoutDates`, and `reminderLeadMinutes`. |
| `GET` | `/api/appointments?status=&from=&to=` | List appointments, optionally filtered by status and time range. |
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
