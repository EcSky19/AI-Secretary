# AI Secretary deployment

AI Secretary is a self-hostable Node.js app. It uses Express, CommonJS, Node's built-in `node:sqlite`, and a SQLite database stored in `./data` by default.

## Requirements

- Node.js 22.5 or newer. Node 24 is recommended.
- npm
- A public HTTPS URL when receiving real Twilio calls.
- Twilio credentials if registering or buying phone numbers.

## Environment

Create a `.env` file in the project root. At minimum, set values like:

```bash
PORT=3000
PUBLIC_BASE_URL=https://your-public-host.example.com
DATABASE_PATH=./data/secretary.db
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15551234567
OPENAI_API_KEY=your_openai_key
ADMIN_USER=admin
ADMIN_PASSWORD=choose_a_strong_password
ADMIN_TOKEN=choose_a_long_random_token
TWILIO_VALIDATE_SIGNATURE=true
```

Never commit `.env`. The app prints booleans for secret-backed configuration with:

```bash
npm run config
```

For public deployments, set `ADMIN_PASSWORD` and/or `ADMIN_TOKEN` so dashboard `/api` data is not open. Basic auth uses `ADMIN_USER` plus `ADMIN_PASSWORD`; `ADMIN_TOKEN` supports Bearer token access and `?token=` URLs for calendar subscriptions.

Keep `TWILIO_VALIDATE_SIGNATURE=true` in production. Set it to `false` only for local testing when Twilio cannot sign requests against your final public URL.

## Run locally with Node on macOS or Linux

```bash
cp .env.example .env # if an example file exists; otherwise create .env
npm install
npm run seed
npm start
```

The server listens on `PORT`, defaulting to `3000`.

## Run locally with Node on Windows PowerShell

```powershell
Copy-Item .env.example .env # if an example file exists; otherwise create .env
npm install
npm run seed
npm start
```

If there is no `.env.example`, create `.env` manually with the settings above.

## Run with Docker

Build and run the production image:

```bash
docker build -t ai-secretary .
docker run --env-file .env -p 3000:3000 -v ai-secretary-data:/app/data ai-secretary
```

The image stores SQLite data at `/app/data/secretary.db`. Mount a volume to keep the database across container restarts.

## Run with Docker Compose

```bash
docker compose build
docker compose up -d
docker compose ps
```

Compose uses `.env` as `env_file`, maps `${PORT:-3000}:3000`, and persists data in the `secretary-data` named volume.

To view logs:

```bash
docker compose logs -f secretary
```

To stop without deleting data:

```bash
docker compose down
```

## Expose the server publicly

Real Twilio phone calls cannot reach `localhost`. `PUBLIC_BASE_URL` must be a public HTTPS URL that routes to this app. Whenever the public URL changes, update `PUBLIC_BASE_URL` and re-run number registration.

### Option A: ngrok

Start the app locally, then run:

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL into `.env`:

```bash
PUBLIC_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

Restart the app and re-register the Twilio number.

### Option B: cloudflared tunnel

Start the app locally, then run:

```bash
cloudflared tunnel --url http://localhost:3000
```

Set `PUBLIC_BASE_URL` to the generated HTTPS tunnel URL, restart the app, and re-register the Twilio number.

### Option C: cloud or VPS host

Deploy to a host such as Render, Railway, Fly.io, or a VPS. Configure:

- `PORT` to the port expected by the host, or use the default `3000`.
- `PUBLIC_BASE_URL` to the host's public HTTPS URL.
- `DATABASE_PATH` to a persistent disk path, or use Docker volume persistence.
- Twilio and OpenAI environment variables as needed.
- `ADMIN_PASSWORD` or `ADMIN_TOKEN` to protect the dashboard API on the public internet.

## Register the client phone number

Registering points the Twilio Voice webhook to:

```text
{PUBLIC_BASE_URL}/voice/incoming
```

You can register a number in three ways.

### UI Phone panel

Open the web UI, go to the Phone panel, and register an owned Twilio number.

### CLI

List owned numbers:

```bash
npm run register-number -- --list
```

Register an owned number:

```bash
npm run register-number -- --number +15551234567
```

Register by Twilio SID:

```bash
npm run register-number -- --sid PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Search available numbers:

```bash
npm run register-number -- --search --area 415
```

Buy a number. This may incur Twilio charges:

```bash
npm run register-number -- --buy +15551234567
```

### Twilio Console

In the Twilio Console, open the phone number and set the Voice webhook to:

```text
https://your-public-host.example.com/voice/incoming
```

Use HTTP `POST`.

## Subscribe to the calendar feed

Booked appointments are published as an iCal feed:

```text
https://your-public-host.example.com/calendar.ics
```

Use the dashboard's Subscribe / Export Calendar link or paste the URL into Google, Apple, or Outlook calendar. If `ADMIN_TOKEN` is configured, subscribe with:

```text
https://your-public-host.example.com/calendar.ics?token=your_admin_token
```

## Troubleshooting

- `PUBLIC_BASE_URL=http://localhost:3000` is fine for local UI testing but will not receive real Twilio calls.
- Node's built-in `node:sqlite` requires Node.js 22.5 or newer.
- If the CLI says Twilio is not configured, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `PUBLIC_BASE_URL` in `.env`.
- If calls do not arrive, confirm your public URL is HTTPS and reachable, then re-run registration so Twilio has the latest webhook.
- If the dashboard shows an authentication banner, reload and sign in with `ADMIN_USER` / `ADMIN_PASSWORD`, or use Bearer token access for API clients.
