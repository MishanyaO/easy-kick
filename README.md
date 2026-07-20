# kick-insights

Live chat co-pilot for [Kick](https://kick.com). FastAPI backend (`server/`) streams chat to
a React dashboard (`client/`).

## Setup (once)

```bash
npm install
cd client && npm install && cd ..
cd server && uv sync && cp .env.example .env && cd ..
```

Needs Node 18+, Python 3.11+, and [uv](https://docs.astral.sh/uv/).

## Simulator mode — no Kick account needed (in root directory)

```bash
npm run dev:simulator
```

Open [http://localhost:5173](http://localhost:5173) and hit **Start** in the amber bar. Chat replays from a canned
dataset.

## Live mode — real Kick chat

```bash
ngrok http 8000        # copy the https URL
```

Create a Kick app (Settings → Developer), setting redirect URI to `<ngrok-url>/auth/callback`
and webhook URL to `<ngrok-url>/webhook`. Tick **Read user information** and **Subscribe to
events**. Put the client ID, secret, and both URLs into `server/.env`.

```bash
npm run dev
```

Then authorize once — open `<ngrok-url>/auth/login`, approve, and:

```bash
curl -X POST <ngrok-url>/subscriptions -H 'Content-Type: application/json' -d '{}'
```

Chat in your channel (`kick.com/<your-username>`) now appears in the dashboard. Tokens are
in-memory, so repeat this step after a backend restart.

---

`npm test` runs the backend suite. See [server/README.md](server/README.md) for endpoints,
config, and the simulator API.

**Note:** only the chat column is real — hype score, topics, and polls are still mocked in
the browser.