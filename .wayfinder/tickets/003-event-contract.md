# 003 — Lock the event contract

Parent: [map](../map.md) · Label: `wayfinder:grilling` · Status: **closed** · Assignee: **Mike**
Blocked by: [004](004-screen-layout.md)

## Question

Define the exact JSON the backend emits and the frontend consumes. This is the
integration seam between three team members and the highest-value artifact on the map —
it is what unblocks the DS and the LLM engineer on hour zero.

The existing `InsightEvent` in [client/src/types.ts](../../client/src/types.ts) is a
15-field kitchen sink built for the mocked dashboard (sentiment, topics, shoutouts,
baselines, annotations). It cannot carry a verdict and most of its fields belong to
widgets now cut. Assume it is replaced, not extended.

**Ordering note.** This ticket was originally scheduled before
[004](004-screen-layout.md) and has been deliberately flipped. The contract's job is to
carry what the surfaces need, and that is discovered by building a rough surface against
invented data — not by reasoning about fields in the abstract. Come here with the
prototype's actual data needs in hand.

[002](002-kick-chat-send-research.md) already forces two things: `observed_in_feed` must be
**nullable** (echo-back is undocumented), and since Kick has no pin, a re-fire inside an
open vote window must not count as a new bandit trial. `replies_to` is available and gives
direct attribution when chat replies to our fired action — decide whether the contract
surfaces that.

Decide:

1. **The event set.** Working assumption is three — `state`, `suggestion`, `verdict` —
   plus the existing `chat`. Confirm or revise. Is `state` a periodic tick or only
   emitted on transition? A tick is easier to render a live timeline from; a transition
   is easier to reason about.
2. **`state`** — which state, confidence or none, the rolling-window metrics it was
   derived from (rpm, unique chatters), and the window that produced it. Must be enough
   to render both the state chip and the timeline, including the `hype_spike` marker
   that produces no suggestion.
3. **`suggestion`** — state that triggered it, the generated copy, `arm_id` and enough
   arm metadata for the card to say *why this variant*, the fallback string, and the
   cooldown/expiry so a stale suggestion can decay in the UI.
4. **`verdict`** — the before and after window snapshots, `deltaRpm`, `deltaUnique`,
   the window length used, `reward` for the bandit, and the plain verdict label. Must
   also be able to represent *measuring, not finished yet* — see
   [005](005-verdict-semantics.md) for what the labels mean.
5. **The adapter boundary.** Where does an incoming event of unknown shape get normalized
   into our `ChatEvent`? Name the module, and make it the single place the day-of dataset
   touches.
6. **Transport.** Everything over the one `/stream` SSE with a discriminated `type`, or
   separate channels? One stream is simpler and already works.
7. **Whether the frontend can build against a mock of this schema** before the backend
   emits it — it should be able to, and that mock should live somewhere the whole team
   can see.

Output: the schema written down, in a form the backend and frontend both point at.


## Resolution

**The contract: [assets/003-event-contract.md](../assets/003-event-contract.md).** Both
sides point at that file.

Decisions made:

1. **Five events, not three** — `chat`, `metrics`, `state`, `suggestion`, `verdict`.
   `metrics` and `state` were split rather than merged. `metrics` is a dumb ~2s tick
   (rpm, unique chatters, current state label) that feeds the sparkline and the chip;
   `state` fires only on transition and is what the detectors actually produce.
   Rationale: the resting sparkline is the thing that proves the app is alive and makes
   the state chip trustworthy — transition-only events flatline it. But a pure tick
   forces the frontend to infer transitions by diffing, and leaves the moment that
   triggers a suggestion implicit. Splitting gives the DS a semantic event with no render
   cadence to think about, and gives the UI a cheap stream with no detector logic in it.
2. **`InsightEvent` is replaced, not extended.** Sentiment, topics, emotes, hype 0–100,
   shoutouts, baseline and annotations are all gone — none survived the audit.
3. **Three `chat` fields added** from [002](002-kick-chat-send-research.md)'s findings:
   `user_id` (the safe key for unique counting), `sub_months` (badge count — a real raid
   discriminator), `replies_to` (direct attribution). Emote names parse from `content`,
   not `payload.emotes`, which is the bug 002 found.
4. **`verdict` is emitted twice** with the same id — `status: 'measuring'` at fire time
   with a countdown, `status: 'final'` when the after-window closes. This is what the
   dock's measuring phase renders, and it means a verdict is never fabricated early.
5. **`observed_in_feed` and `reward` are nullable**, and `label`/`before`/`after` are null
   while measuring. Nothing we cannot know gets a plausible default.
6. **Every generated string has a fallback**, flagged by `generated: false`. The frontend
   never receives an empty `copy`.
7. **Adapter boundary named**: `server/src/easy_kick/adapters.py`, the only place a foreign
   shape becomes a `ChatEvent`. The day-of dataset is one function there.
8. **One stream** — the existing `/stream` SSE, discriminated by `type`.

Four fields exist because [004](004-screen-layout.md) built the surfaces first and found
them: `replies` + `sample_replies`, `held_min`, `votes[]` (with an off-topic bucket), and
`raiders{arrived,spoke}`. None were in the original plan. That is the ordering flip paying
for itself.

Left open deliberately, owned by other tickets: `label` thresholds and the `reward`
definition ([005](005-verdict-semantics.md)), poll and vote mechanics
([006](006-vote-capture.md)).


### Amendment — verdict labels (same session)

`label` was widened from the brief's three values to **four**: `Worked` / `Neutral` /
`Backfired` / `Can't tell`. "Too noisy" was ambiguous between *chat responded badly* and
*we cannot attribute this*, which are different outcomes needing different responses.
`Backfired` (negative delta) did not exist at all, so the product could only report good or
indifferent news. A `contaminated: string | null` field carries the plain-words reason
whenever the label is `Can't tell`. Rejected `Failed` because it collides with send failure.
Cut points and the contamination rule remain owned by [005](005-verdict-semantics.md).


### Amendment 2 — superseded by Gambit (PR #5)

Contract **v1 is withdrawn**. PR #5 merged (to `dev`) with a working controller, bandit,
reward book and gym, and its own SSE frames in `notes/gambit-engineering.md` §8. Two
contracts cannot ship; his has running code and 831 lines of tests, so
[the asset](../assets/003-event-contract.md) was rewritten as **v2** — his frame names,
plus ten added fields our prototype proved the surfaces need (`expires_in_s`, `label`,
`contaminated`, `replies`, `sample_replies`, `held_s`, `raiders`, an `off-topic` vote
bucket, and three chat fields from 002). No renames, no reshaping.

The v1 event names (`metrics` / `state` / `suggestion` / `verdict`) are dead. The
*reasoning* behind them mostly survived translation: the tick-vs-transition split maps onto
his `controller.context` / `controller.insight`, and the two-phase verdict onto his
window-close `controller.result`.
