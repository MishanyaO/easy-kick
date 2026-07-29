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

Open [http://localhost:5173](http://localhost:5173) and hit **Start gym**. A simulated
audience of 120 personas reacts to what the bot does, and the controller runs the real loop
against it — nothing about the decisions or the measurement is faked.

The app has two surfaces. **Live** is the panel a streamer parks over their OBS preview:
it stays quiet until chat needs something, then offers one action to approve. **Review** is
the ledger — every closed window grouped by outcome, plus a **Tactics** tab showing what the
bandit has learned per chat state.

## Live mode — real Kick chat

```bash
ngrok http 8000        # copy the https URL
```

Create a Kick app (Settings → Developer), setting redirect URI to `<ngrok-url>/auth/callback`
and webhook URL to `<ngrok-url>/webhook`. Enable user read, event subscriptions, channel read,
and chat write. Put the client ID, secret, both URLs, broadcaster ID, and a
`KICK_CONTROL_API_KEY` into `server/.env`; expose the same key to the dashboard as
`VITE_CONTROL_API_KEY`.

```bash
npm run dev
```

Then authorize once — open `<ngrok-url>/auth/login`, approve, and:

```bash
curl -X POST <ngrok-url>/subscriptions -H 'Content-Type: application/json' -d '{}'
```

Chat in your channel (`kick.com/<your-username>`) now appears in the dashboard. Tokens are
in-memory, so repeat this step after a backend restart.

## Query params

- `?kick` mounts the same live surfaces inside a replica of dashboard.kick.com/stream.
- `?insights` mounts the Review drawer as its own page, at full viewport.

---

`npm test` runs the backend suite. See [server/README.md](server/README.md) for endpoints,
config, and the simulator API.

The loop is: read chat state → pick an intervention (or deliberately pick nothing) → wait
60s → measure lift against comparable quiet windows → update the posterior. Design notes are
in [notes/](notes/); the frontend decision record is in [.wayfinder/](.wayfinder/).
