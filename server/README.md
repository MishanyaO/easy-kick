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

## Simulator (no Kick account needed)

Replay a canned dataset instead of waiting for real chat. Off by default — enable with
`KICK_SIMULATOR_ENABLED=true` in `.env` (or use `npm run dev:simulator` from the repo
root, which sets it for you), which mounts the `/dev` routes:

```bash
curl http://localhost:8000/dev/replay                               # status
curl -X POST 'http://localhost:8000/dev/replay?speed=5&loop=true'   # start
curl -X DELETE http://localhost:8000/dev/replay                     # stop
```

All three return the same shape, so a UI can poll one endpoint:

```json
{"status": "running", "speed": 5.0, "loop": true, "total": 60, "sent": 28,
 "dataset": "sample_stream.jsonl"}
```

Replayed events go through the same store-and-publish path as real webhooks, so they
appear on `/stream` and `/messages` identically. The dataset is
[`data/sample_stream.jsonl`](data/sample_stream.jsonl) — 60 events, ~63s at `speed=1`.

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
| GET | `/stream?backlog=` | Live chat as Server-Sent Events (backlog replayed first) |
| GET | `/health` | Liveness + buffer stats |
| GET | `/dev/replay` | Replay status + progress (simulator only) |
| POST | `/dev/replay?speed=&loop=` | Start dataset replay (simulator only) |
| DELETE | `/dev/replay` | Stop the replay (simulator only) |

## Tests

```bash
uv run pytest -q
```
