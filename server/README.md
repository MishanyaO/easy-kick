# easy-kick backend

The easy-kick backend — a small FastAPI service that ingests events from the [Kick](https://kick.com) streaming
platform — primarily chat messages — via Kick's official webhook API. Incoming events are
signature-verified (RSA-SHA256), deduplicated, logged to stdout, and kept in an in-memory
ring buffer that a small read API exposes. There is no database: data is lost on restart.

## Setup

```bash
uv sync                # creates .venv and installs deps (incl. dev group) from uv.lock
cp .env.example .env   # then fill in your Kick app credentials
```

## ngrok setup

Kick delivers webhooks over the public internet, so it needs a public HTTPS URL that
tunnels to your local server. The Kick app (you create in the next step) must point at
this URL, so get it **before** creating the app.

[ngrok](https://ngrok.com) is the easiest option:

```bash
brew install ngrok                 # or download from https://ngrok.com/download
ngrok config add-authtoken <token> # one-time; grab the token from the ngrok dashboard (free signup)
ngrok http 8000                    # start the tunnel
```

ngrok prints a forwarding URL like `https://<random>.ngrok-free.dev`. That is your
**`<public url>`** for every step below. (Any HTTPS tunnel works — `cloudflared`, etc.)

> **Important:** on ngrok's free tier the URL changes every time you restart it. When it
> rotates you must update the Kick app config *and* `.env` (below) to match, then restart
> the server.

## Creating a Kick app

1. Sign in at [kick.com](https://kick.com) (2FA must be enabled).
2. Go to **Settings → Developer → Create App**.
3. Set the **redirect URI** to `<public url>/auth/callback` and the **webhook URL** to
   `<public url>/webhook`, using the ngrok URL from the previous step.
4. Copy the Client ID and Client Secret into `.env`, and set `KICK_REDIRECT_URI` /
   `KICK_PUBLIC_BASE_URL` to `<public url>/auth/callback` and `<public url>`.

## Running

```bash
uv run uvicorn easy_kick.main:app --port 8000
```

## One-time authorization

Chat events require the broadcaster to grant your app the `events:subscribe` scope:

1. Open `<public url>/auth/login` in a browser and approve as the streamer.
2. Create the subscriptions: `curl -X POST <public url>/subscriptions -H 'Content-Type: application/json' -d '{}'`
   (defaults to all supported event types; pass `{"events": ["chat.message.sent"]}` for chat only).

Chat messages will now stream into the app — watch stdout or query the read API.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/webhook` | Receives signed Kick events (all types) |
| GET | `/auth/login` | Starts the OAuth 2.1 + PKCE flow |
| GET | `/auth/callback` | OAuth redirect target; stores tokens in memory |
| GET | `/auth/status` | Whether the app holds a user token |
| POST | `/subscriptions` | Subscribe to Kick events (`{broadcaster_user_id?, events?}`) |
| GET | `/subscriptions` | List active subscriptions |
| DELETE | `/subscriptions?id=…` | Delete subscriptions by id |
| GET | `/messages?sender=&limit=` | Recent chat messages, newest first |
| GET | `/events?type=&limit=` | Recent events of any type, newest first |
| GET | `/health` | Liveness + buffer stats |

## Tests

```bash
uv run pytest -q
```
