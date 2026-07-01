# Deploy AI Secretary

AI Secretary is meant to run on a real public website so Twilio can send phone calls to it. The easiest path below uses Render and does not require command-line work or editing files.

## How accounts and phone numbers work (multi-tenant)

This is a multi-tenant app: one deployment serves many businesses, each fully
isolated. There are two roles:

- **Platform operator (you, who deploys this):** you connect ONE master Twilio
  account via the `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` environment
  variables. This account is used to buy/assign a phone number for each business
  that signs up.
- **Businesses (tenants):** they self-serve **sign up** with an email and
  password, then claim a phone number from the dashboard. They never enter
  Twilio credentials. Incoming calls are routed to the correct business by the
  dialed number.

Authentication is enforced automatically: `/api` requires a logged-in session
whenever any business has signed up, when `NODE_ENV=production` (the default in
the provided Docker/cloud configs), or when `AUTH_REQUIRED=true`. A brand-new
local/dev instance with no signups stays open for convenience and tests.

## What you need first

- A GitHub account and a copy of this repository in your GitHub account.
- A Render account. A paid Render service/disk is recommended for a real business.
- A Twilio account with a little credit for phone calls, SMS, and buying a number.
- About 15 minutes.

## Fastest way (recommended): deploy to the cloud with Render

This repository includes `render.yaml`, a Render Blueprint. It tells Render how to run the app, use Node 22 through the included Dockerfile, check `/health`, and store the SQLite appointment database on a persistent disk at `/data/secretary.db`.

1. Sign in at [render.com](https://render.com) or create an account.
2. Put this project in your own GitHub account if it is not already there.
3. In Render, click **New +**.
4. Choose **Blueprint**.
5. Connect GitHub when Render asks.
6. Pick the GitHub repository for AI Secretary.
7. Render will read `render.yaml` automatically.
8. Review the service named **ai-secretary**. Leave the default settings unless you know you need to change them.
9. Click **Apply** or **Deploy**.
10. Wait for the build to finish. The first deploy can take several minutes.
11. Open the public Render URL when it appears.
12. Follow the setup wizard in your browser.

The setup wizard walks you through the business name, business hours, open days, blackout dates, appointment length, admin login, Twilio connection, and phone number setup. On this Render path, you should not need to use a terminal, edit `.env`, or manually set Twilio webhook URLs.

### What the setup wizard replaces

For most owners, Twilio credentials, the admin password, business hours, open days, blackout dates, and reminder settings can be entered in the browser. Environment variables still exist for technical users who want fixed overrides, but they are not required for the normal Render setup.

## Other cloud options

Render is still the recommended path for most owners. The repository also includes starting configs for Fly.io and Railway.

### Fly.io

`fly.toml` is included. Before going live, set the Fly app name and region for your business and set `PUBLIC_BASE_URL` to the real Fly URL. The included volume named `secretary_data` mounts at `/data`, so the database can live at `/data/secretary.db`.

### Railway

`railway.json` is included. In Railway, add a volume mounted at `/data` and set:

```text
DATABASE_PATH=/data/secretary.db
```

Railway's public domain is auto-detected through `RAILWAY_PUBLIC_DOMAIN`, so most owners do not need to manually set `PUBLIC_BASE_URL` there.

## Data persistence and backups

AI Secretary stores appointments, settings, messages, setup status, Twilio settings, and the admin password hash in a SQLite file. If that file is stored on an ephemeral host disk, the app may look fresh after a restart and your schedule can be lost.

The included `render.yaml` sets:

```text
DATABASE_PATH=/data/secretary.db
```

and mounts a persistent Render disk at `/data`, so appointments survive deploys and restarts.

### Automatic backups

The app creates consistent SQLite backups with `VACUUM INTO`. Backups are stored in `<data dir>/backups` by default, or in `BACKUP_DIR` if you set one. On cloud hosts, make sure the backups folder is also on the persistent disk, not temporary storage.

Useful backup settings:

| Variable | Use |
| --- | --- |
| `BACKUPS_ENABLED` | Turn scheduled backups on or off. Default: `true`. |
| `BACKUP_INTERVAL_HOURS` | Hours between automatic backups. Default: `24`. |
| `BACKUP_KEEP` | Number of newest backups to keep. Default: `14`. |
| `BACKUP_DIR` | Optional backup folder. Defaults to `<data dir>/backups`. |

The dashboard has a Backups panel. Technical users can also use authenticated API endpoints:

- `GET /api/backups` lists backup files.
- `POST /api/backups` creates a backup now.

Manual command-line backup:

```powershell
node scripts/backup.js
```

### Restore a backup

Restoring overwrites the current database. Use this order:

1. Stop the app.
2. List backups if needed:

   ```powershell
   node scripts/restore.js
   ```

3. Restore the chosen file:

   ```powershell
   node scripts/restore.js secretary-YYYYMMDD-HHMMSS.db
   ```

4. Restart the app so it opens the restored database.

For a real business, also keep host-level disk snapshots or downloaded copies before large changes or moving hosts.

## Forgot admin password

If the owner is locked out of the dashboard, a technical helper can reset the login directly in the same SQLite database:

```powershell
node scripts/reset-admin.js newpass1
node scripts/reset-admin.js --user owner newpass1
```

Passwords must be at least 6 characters. Restart the app afterward if it is already running. These scripts are run directly with `node`; you can add npm aliases later if you prefer, but `package.json` is not required for them.

## CSV appointment export

The dashboard Export button downloads appointments as a spreadsheet-friendly CSV for record keeping. The authenticated endpoint is:

```text
GET /api/appointments/export.csv?status=all|booked|cancelled&from=&to=
```

Use `status`, `from`, and `to` to narrow the export before importing it into a spreadsheet.

## Security defaults

Security headers are always enabled. Rate limiting protects the public setup pages and Twilio voice webhook routes to reduce abuse. Keep these defaults unless a technical operator has a specific reason to change them:

| Variable | Use |
| --- | --- |
| `RATE_LIMIT_ENABLED` | Enable rate limiting. Default: `true`. |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window length. Default: `60000`. |
| `RATE_LIMIT_MAX` | Requests allowed per window per client. Default: `120`. |

## Connecting your phone number

Twilio is the phone company layer. It receives the real call, then sends it to AI Secretary over the internet.

1. Create or sign in to your Twilio account.
2. Add a little credit so Twilio can buy a number and handle calls/SMS.
3. Open your deployed AI Secretary website.
4. Complete the setup wizard's Twilio step.
5. Either search for and buy a number inside the app, or choose an existing Twilio number you already own.
6. The app points the number's Voice webhook to your public site automatically.

The webhook is the URL Twilio calls when someone phones your business. It looks like:

```text
https://your-public-site.example.com/voice/incoming
```

On Render and Railway, the app can detect the public URL automatically. On other hosts, a technical user may need to set `PUBLIC_BASE_URL`.

## Run it on your own computer (advanced)

Local running is useful for technical testing, but Twilio cannot call `localhost` directly. For real phone calls to reach a local computer, you also need a public HTTPS tunnel such as ngrok.

### Docker

```powershell
docker build -t ai-secretary .
docker run --env-file .env -p 3000:3000 -v ai-secretary-data:/app/data ai-secretary
```

The Docker image uses Node 22 and stores data in `/app/data`. Keep the volume so the database and default backups folder are not deleted.

### Docker Compose

```powershell
Copy-Item .env.example .env
docker compose build
docker compose up -d
```

`docker-compose.yml` already uses a named volume called `secretary-data`.

### Node.js directly

You need Node.js 22.13 or newer because the app uses the built-in `node:sqlite` module without flags. Earlier 22.x releases require `--experimental-sqlite`; Node 23.4+ and 24+ work flag-free.

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Open `http://localhost:3000`. For Twilio testing, run a tunnel such as:

```powershell
ngrok http 3000
```

Then use the tunnel's HTTPS URL as `PUBLIC_BASE_URL` and register the Twilio number again.

## Useful environment variables for technical users

The browser setup wizard is the normal path. These variables are optional overrides or hosting settings:

| Variable | Use |
| --- | --- |
| `DATABASE_PATH` | SQLite file location. Must be on persistent storage in production. |
| `PUBLIC_BASE_URL` | Public HTTPS URL if your host cannot auto-detect it. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | The PLATFORM (master) Twilio account used to provision a number for each tenant. `TWILIO_PHONE_NUMBER` is only a fallback for the default tenant. |
| `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_TOKEN`, `AUTH_REQUIRED` | Optional operator back-compat auth mapped to the default tenant, plus `AUTH_REQUIRED=true` to force session auth on `/api`. Tenants normally sign up and log in instead. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional AI model settings. Without OpenAI, the built-in rule-based fallback can still run. |
| `TWILIO_VALIDATE_SIGNATURE` | Keep `true` in production. Use `false` only for local tunnel testing if needed. |
| `BACKUPS_ENABLED`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `BACKUP_DIR` | Automatic backup schedule, retention, and folder. |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Public route rate-limit controls. Keep defaults for production. |

## Troubleshooting

- **The setup wizard appears again after a restart:** the database is not on persistent storage, or the disk is mounted at the wrong path. On Render, confirm the disk is mounted at `/data` and `DATABASE_PATH` is `/data/secretary.db`.
- **Calls are not answered:** confirm the app URL opens in a browser, the Twilio number is registered in the app, and Twilio's Voice webhook points to `/voice/incoming` on the public HTTPS site.
- **The app warns about `usingLocalhost`:** the app thinks its public URL is localhost. That is okay for local testing, but real Twilio calls need a public HTTPS URL. On custom hosts, set `PUBLIC_BASE_URL`.
- **Render deploy fails with SQLite or Node errors:** the app requires Node.js 22.13 or newer. The included Render config uses Docker with `node:22-slim` to satisfy this.
- **Appointments disappeared:** stop the app, restore from your latest backup, restart, then check that the host is using persistent disk storage, not temporary storage.
- **The owner forgot the admin password:** run `node scripts/reset-admin.js newpass1`, then restart the app.
