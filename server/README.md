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

## Gambit — the controller

A loop that reads chat state, picks an intervention (or nothing), waits 60s, measures the
lift against a matched control, and updates a Beta posterior. Four bandit arms × three chat
states = twelve posteriors, Thompson sampling, stdlib only.

| Module | Job |
|---|---|
| `context.py` | Viewer count, category and uptime from `GET /channels`. Degrades to `viewer_count = None` |
| `engagement.py` | Rolling 60s metrics from the event store, and `lull` / `steady` / `spike` |
| `bandit.py` | The policy, plus the `random` / `timer` / `silent` baselines |
| `reward.py` | Scores a closed window against a matched control, not a raw level |
| `controller.py` | The loop, the safety rails, and the human in the loop |
| `gym.py` | A reactive persona simulator with forkable twin worlds, and the headless harness |

Nothing is persisted. Chat is processed in memory and only aggregate counts reach the policy.

The gym is the development environment: it writes `EventEnvelope`s into the same store real
webhooks write into, so the bandit never sees anything it would not see live.

```bash
curl -X POST 'http://localhost:8000/dev/gym?speed=10&seed=1'          # live, into /stream
curl -X POST 'http://localhost:8000/dev/gym/speedrun?decisions=2000'  # headless, flat out
curl -X POST 'http://localhost:8000/dev/gym/race?policies=gambit,timer'
uv run python -m easy_kick.eval.run_eval --worlds 12    # writes data/eval_results.json
```

Against live Kick traffic the loop is off by default. Set `KICK_CONTROLLER_ENABLED=true` and
`KICK_BROADCASTER_USER_ID` to run it for real — it needs the `chat:write` and `channel:read`
scopes. Set `KICK_CONTROL_API_KEY` when the server is exposed through a tunnel; controller
mutations then require the same value in the `X-Control-Key` header. Only one clock may drive
the loop, so leave it off when running the gym.

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
| GET/POST/DELETE | `/dev/gym?speed=&seed=` | The reactive gym, driving the controller on virtual time (simulator only) |
| POST | `/dev/gym/speedrun?decisions=&policy=&truth=` | Headless run, flat out (simulator only) |
| POST | `/dev/gym/race?seed=&policies=` | One world per policy on the same seed (simulator only) |
| GET | `/controller/policy` | Learned table, rails, and the generated insight sentences |
| POST | `/controller/action/{id}/{send\|dismiss}` | Streamer approves or vetoes a suggested card |
| PUT | `/controller/autonomy` | Per-arm `auto`/`ask`/`off`, and the kill switch |
| GET | `/eval/results` | Whatever `easy_kick.eval.run_eval` last wrote |

`/stream` carries chat plus the controller's own frames — `controller.action`, `controller.result`,
`controller.bandit`, `controller.context` — as synthetic event types whose payload is already the
frontend shape (`client/src/types.ts`).

## Tests

```bash
uv run pytest -q
```
