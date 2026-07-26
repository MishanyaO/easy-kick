# Map: Kick Insights — frontend spec for hackathon Saturday

Labels: `wayfinder:map`

## Destination

A locked frontend spec the team can execute against on hackathon Saturday, covering:
the widget set, the screen flow, the state machine for every widget (cold / empty /
live / fired / measuring / measured), and the **frontend↔backend event contract**
(`state`, `suggestion`, `verdict`) that three team members integrate across.

Done when nothing is left to *decide* before someone builds it. Saturday should be
execution, not design.

## Notes

**Domain.** Real-time chat insights for Kick. The product is a closed loop —
MONITOR chat → SUGGEST an action → ACT in chat → MEASURE the lift — not a dashboard.
The test for any widget: *would the streamer do something differently because of it?*
A number they can't act on is slop.

**Team.** 4 people. DS owns detectors. LLM engineer owns copy generation + the bandit
logic. Two full-stack; the map's owner is frontend and owns every surface.

**Judging weights** (these drive priority, and they are counterintuitive):
Product thinking 25% · Creativity 25% · Technical execution 20% · Demo 10% ·
Collaboration 10% · UX 10%. Polish is 20% combined — widgets earn their place by making
the *thinking* legible, not by looking good.

**Detailed spec and datasets drop on the day.** The internal schema therefore needs a
named adapter boundary so day-of data is one adapter, not a rewrite.

### Standing constraints settled while charting (do not relitigate)

1. **Act is real, with a sim branch.** Firing an action calls the backend, which posts
   to Kick chat in live mode and injects into the simulated chat in sim mode. One code
   path; only the destination swaps. Rationale: the verdict is only honest if the fired
   message is part of the same stream being measured.
2. **~~Measurement window stays 2 min / 2 min.~~ SUPERSEDED — see 9.** Wall clock is still
   compressed by the simulator's speed multiplier, and the window length still ships as a
   field the card states.
3. **~~Three acting states: `lull`, `debate`, `raid_wave`.~~ SUPERSEDED — see 10.**
4. **~~Arms are LLM-generated phrasing variants within a state.~~ SUPERSEDED — see 11.**
   Two surfaces (live loop + experiment view) still stands.
5. **The bandit never gates the live path.** If arm selection is slow or broken, the
   suggestion falls back to the first variant and the loop still runs.
6. **Experiment surface is in scope but lowest priority** — built after the live loop
   works end to end. Contract carries `arm_id` / `reward` from hour zero so it is never
   blocked; the panel itself is the last thing built.
7. **The scored demo runs on the simulator by default.** Live webhook is the reveal, not
   the dependency.
8. **Two surfaces, live mode is the default.** The streamer is playing a game and is not
   looking at our app; a mid-match glance holds about one thing. Live mode is a slim,
   near-silent surface carrying the state and one tappable suggestion. Review mode is one
   click away. Same event stream, two densities — composition, not a second app.
   *(Amended by [004](tickets/004-screen-layout.md): live mode is a **floating,
   user-positioned panel over the OBS preview**, not a docked column — an undocked OBS
   panel, positioned once by the streamer during setup.)*

### Adopted from the Gambit spec (PR #5, merged to `dev` 2026-07-25)

Our LLM engineer's spec — `notes/gambit-pitch.md` and `notes/gambit-engineering.md` — is
now the reference model, with running code and 831 lines of tests behind it. Where it
disagreed with constraints 2–4 above, **it wins**, for the reasons recorded here.

9. **Reward is lift against a *matched control*, not before-and-after.** The 60s-before
   estimator (`naive`) is biased **upward**: you fire because chat dipped, so mean
   reversion flatters you. What ships is `matched` — mean participation of the last K
   **clean** same-state windows where nothing fired. Both are implemented, because the
   comparison between them *is* the evidence. Windows starting within 120s of a fire are
   tagged `contaminated` and excluded from the control pool, though they still count as
   decisions. Outcome window is **60s**, not 2+2.
10. **Three chat states: `lull`, `steady`, `spike`.** Replaces our five. Cleaner for a
    bandit (3 states × 5 arms = 15 cells) and it separates *what triggered it* from *what
    to do*, which our set conflated — "debate" and "raid" were really arms wearing a
    state's clothing. `influx` (raid) is the first addition if ahead.
11. **Arms are tactics, not phrasings**: `nothing`, `emote_rally`, `chat_poll`,
    `question_relay`, `shoutout`; `prediction` is a stretch. Our phrasing-variant idea
    fails three ways — variants separate far less than tactics do in ~40 decisions, a set
    regenerated per decision has no stable identity to hold a posterior, and it couples the
    LLM *into* the policy so a failed call leaves nothing to select from. Phrasing-level
    learning is fleet-scale roadmap, not a hackathon arm set. Demo-critical set is
    `nothing` + `emote_rally` + `chat_poll`.
12. **`nothing` is a first-class arm** with its own posterior, and every intervention is
    charged a small `fire_cost`. So an intervention must earn its interruption and silence
    competes on evidence. This is the real answer to "won't this spam my chat", and it is
    the thing a timer bot structurally cannot have an opinion about.
13. **The primary metric is participation rate** — unique chatters ÷ `viewer_count` from
    `GET /channels`, degrading to a normalised msgs/min + unique blend when viewers are
    unknown. Raw msgs/min is gameable by spam, confounded by whatever is happening
    on stream, treats 5 people flooding the same as 50 joining in, and is not comparable
    across channels (the precondition for pooled priors).
14. **Autonomy is per-arm** — `auto` / `ask` / `off`, keyed to what an arm spends, with a
    trust ratchet. A **dismissal is not a fired arm**: it updates a separate
    streamer-preference counter, never the arm's chat-response posterior, and voids the
    open window. Rails (cooldown, caps, quiet hours, kill switch) are human-set and never
    learned.

**Skills to consult each session:** `/grilling` and `/domain-modeling` for decision
tickets, `/prototype` for the prototype tickets.

## Decisions so far

<!-- one line per closed ticket -->

- [002 — Kick chat-send: echo-back, identity, rate limits](tickets/002-kick-chat-send-research.md) —
  echo-back **undocumented** so build for no-echo (`observed_in_feed` nullable); **no native
  poll and no native pin**, so chat-parsed voting is the only path and the fired prompt
  scrolls away; rate limits deliberately unpublished; `replies_to`, `sender.user_id` and
  badge `count` are free signal we aren't reading.
- [008 — Surfaces and the attention budget](tickets/008-surfaces-attention-budget.md) —
  live mode is a **360px vertical OBS browser dock**: one phase-driven slot (healthy /
  detected / fired / measured) plus an ambient sparkline, nothing else, and the **verdict
  surfaces in live mode**. Visual only, no sound — a lull is a minutes-long condition, so
  the goal is *be unmistakable when he looks*, not interrupt; cooldown doubles as expiry.
  Review mode is one page — timeline + ledger with a **by-time / by-arm toggle**, and the
  by-arm grouping *is* the experiment surface. Demo opens in live mode.
- [004 — Screen layout and widget states](tickets/004-screen-layout.md) — **live mode = a
  floating user-positioned panel parked over the OBS preview** (overturns 008's docked
  column); four phases in one slot. **Review mode = rows grouped by verdict** with filter
  tiles, expandable state-specific detail, and the bandit on its own Tactics tab leading
  with *what it would pick next* — **confirmed by the team 2026-07-26**. Surfaced four new
  contract fields: `replies`, `heldMin`, `votes[]`, `raiders`.
- [003 — Lock the event contract](tickets/003-event-contract.md) —
  **[the contract](assets/003-event-contract.md)**. Five events: `chat`, `metrics`,
  `state`, `suggestion`, `verdict`. `metrics` (dumb ~2s tick) and `state` (transition only)
  deliberately split. `InsightEvent` replaced outright. `verdict` emitted twice
  (`measuring` → `final`). Unknowables are nullable; every generated string has a
  fallback. Adapter boundary named `adapters.py`. **Amended:** four verdict labels —
  `Worked` / `Neutral` / `Backfired` / `Can't tell` — replacing the brief's ambiguous
  "Too noisy"; `Backfired` makes the headline total a net rather than a one-way number.
  **Superseded by PR #5** — [contract v2](assets/003-event-contract.md) adopts Gambit's
  `controller.*` frames and folds our ten added fields into them.

## Not yet specified

- **The demo script, and making each teammate's contribution visible.** Collaboration is
  an explicit 10% and judges look for evidence of every member contributing. Can't be
  written until the widget set and the loop are settled.
- **Whether pre-built work counts as a submission.** The Gambit spec §11 flags that the
  public rules describe the submission as work created during the event. If that is
  enforced, both PR #5 and our prototype are unusable as submission code. Someone must ask
  the organisers **before** Saturday — this is the highest-leverage unknown on the map.
- **Which branch is trunk.** PR #5 declared base `main` but merged to `dev`; `main` is
  still at `000d026`. Needs a one-line answer from the team.
- **Simulator scenario definitions** — how "trigger lull" / "trigger raid" / "trigger
  debate" inject into the pipeline to produce real detections. Depends on the DS's
  detector inputs, which don't exist yet.
- **Whether an API-sent message echoes back through the chat webhook.** Undocumented, so
  it needs a 5-minute empirical test once [001](tickets/001-kick-write-scope.md) confirms a
  write scope exists. Not ticketed yet because the test is trivial and rides along with 001.
- **What the day-of dataset forces.** Unknowable until it drops; the adapter boundary is
  the hedge.

## Out of scope

- **Detector rules and thresholds** — the DS owns the implementation. This map only
  fixes the *contract* the detections arrive in.
- **LLM prompt engineering for action copy** — the agent engineer owns it. The map fixes
  the JSON shape and the fallback-string requirement.
- **The bandit algorithm itself** — the LLM engineer owns it, and it now exists
  (`bandit.py`, Thompson over 15 Beta posteriors). This map owns the surface only.
- **The gym, reward and engagement modules** — shipped in PR #5. This map does not
  redesign them; it consumes their frames.
- **`hype_spike` as an acting state** — ruled out because the action (flag clip) does not
  change chat and so cannot participate in the measure loop. Still detected, still marks
  the timeline.
- **Rebuilding ingestion** — webhook ingest, signature verification, dedupe, ring buffer
  and SSE already work and are not to be touched.

## Tickets

Frontier (open, unblocked, unclaimed) is computed by reading `tickets/`.

| Ticket | Type | Blocked by |
|---|---|---|
| [001 — Confirm the Kick app's chat-write scope](tickets/001-kick-write-scope.md) | task | — |
| [005 — Verdict semantics and thresholds](tickets/005-verdict-semantics.md) | grilling | — |
| [006 — Vote capture and the poll card](tickets/006-vote-capture.md) | grilling | — |
| [007 — Convergence chart and explore/exploit](tickets/007-experiment-surface.md) | prototype | 005 |
