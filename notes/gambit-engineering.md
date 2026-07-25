# Gambit — engineering spec

A chat co-host that treats every intervention as a bet, measures whether it paid off, and
learns which bets work in a given channel.

Easygo Mini Hackathon, Challenge 2. Melbourne, 1 August 2026, 9:00–18:00.

Read §3 (what Kick gives us), §5 (arms) and §8 (contracts) before writing code.

---

## 1. What we're building

A loop running server-side against the existing event pipeline:

```
read chat state  →  pick an intervention (or nothing)  →  wait 60s
                 →  measure lift against a control     →  update the posterior
```

Five arms, three chat states, fifteen Beta posteriors, Thompson sampling. The policy is about
80 lines with no dependencies. Small on purpose — the interesting part is the measurement.

Alongside it, a simulated chat environment (the gym) that reacts to what the bot does. It is
our development environment and test harness. §9 is explicit about what it does and does not
prove. Everything stays in memory, per `server/AGENTS.md`.

---

## 2. Why a bandit, and where the model strains

Feedback is partial: we only ever see the outcome of the arm we pulled, never what a different
one would have done at that moment, so there is no labelled "correct intervention" to train
on. Exploration is necessary because chat cultures differ — the best arm on a slots channel is
not the best arm on an FPS channel. The best arm depends on state, which makes it contextual.
And rewards are stochastic, so we are estimating a distribution rather than looking up a value.

Where it strains:

| Complication | Why it matters | Handling |
|---|---|---|
| Delayed reward | Lift is only measurable ~60s after firing | Pending-window queue; posterior updates on window close, not on fire |
| Actions change future state | Strictly an MDP, not a bandit | Deliberate myopic approximation. With ~40 decisions per stream, RL credit assignment has no chance. A bias/variance choice we can name |
| Novelty decay | Repeated interventions can weaken | Discounted updates let recent evidence replace old evidence. Repeat count is not a model input, so do not claim a precise fatigue threshold |
| Confounding by stream content | A clutch play spikes chat regardless of us | Reward is lift against a control window, never raw level (§6) |
| Interference between arms | Two fires in one window contaminate attribution | Global cooldown; one open window at a time; contaminated windows excluded from the control pool (§6) |

Not A/B testing — a single stream cannot support split traffic. This is sequential
experimentation with adaptive allocation, which is the better tool anyway: a bandit stops
spending traffic on losing variants instead of running to a fixed horizon.

### What our lift numbers can support

Autonomous decisions are sequentially randomized conditional on observed state and history.
We log the probability of each choice and maintain a minimum allocation to `nothing`, so
propensity-aware evaluation is possible and control coverage does not disappear.

The hackathon estimator compares clean fired and quiet windows in the same chat state. This
reduces mean-reversion bias, but matching alone does not identify a causal effect. Treat
single-stream lift as directional; use the logged propensities for IPS or doubly-robust
estimates once there is enough traffic.

Streamer-approved actions are a separate observational cohort. Approval is not randomized, so
their outcomes must not be mixed into the autonomous-action causal estimate.

---

## 3. What Kick gives us — verified

Checked against the public docs. Re-verify on the day; Kick engineers are mentors and asking
directly is free signal.

**Chat.** `POST /public/v1/chat` sends a message as a user or a bot account.
`DELETE /public/v1/chat/{id}` removes one. Scope `chat:write`. Everything in §5 Tier 1 runs
through this.

**Events (`events:subscribe`).** Already ingested: `chat.message.sent`, `kicks.gifted`,
`channel.reward.redemption.updated`, `channel.followed`, `channel.subscription.*`,
`moderation.banned`. Two we should add:

- `livestream.status.updated` — stream start/end.
- `livestream.metadata.updated` — title, **category**, language or rating changed. A category
  switch is a real regime change for chat and this tells us for free.

**Channel metadata.** `GET /channels` returns `viewer_count`, `category`, `stream_title`,
`is_live`, `start_time`, `active_subscribers_count`. Needs `channel:read` or an app access
token. One polling loop, and the highest-value thing we are currently missing — see §6.

**Channel points.** Native on Kick. Scopes `channel:rewards:read` / `channel:rewards:write`
exist. If the write endpoint does what the name implies we could create a time-limited reward
on the fly. Unverified, stretch only.

**Polls and predictions are UI-backed chat commands, not REST endpoints.** `/poll` and
`/prediction` open setup UI for a streamer or moderator; there is no documented parameterized
API.

If time permits, mod the bot account and test the commands through `POST /public/v1/chat`.
Assume card-only unless the test proves otherwise; the result must not block Tier 1.

**Kick has no native hype train** — that is a Twitch feature. What we previously called
`hype_train` is a bot-run emote rally. Name it that; do not claim a feature that does not exist.

**Operational.** Webhook payloads are signature-signed (done). Kick retries ~3 times then
auto-unsubscribes if the endpoint is unreachable — on venue wifi this will happen, so we need a
health check plus auto-resubscribe or the demo dies quietly. A community Pusher WebSocket feed
exists as an unofficial read-only fallback.

---

## 4. What already exists in our repo — do not rebuild

| Layer | What's there | Where |
|---|---|---|
| Ingest | Kick OAuth 2.1 + PKCE, RSA-SHA256 signature-verified webhooks, dedupe | `server/src/easy_kick/{oauth,security,routes/webhook}.py` |
| Store | Bounded ring buffer (10k events) + pub/sub fan-out | `store.py`, `hub.py` |
| Read API | `/messages`, `/events`, `/health`, SSE `/stream` | `routes/read.py` |
| Sim v1 | Linear JSONL replay, speed 1–100×, loop | `routes/simulator.py` |
| Dashboard | 3-column: ActionFeed / hype timeline / ChatPanel. Recharts, framer-motion, tailwind | `client/src/` |
| FE contract | `ActionEvent`, `ActionResult` (with `engagement_delta`) already defined | `client/src/types.ts` |

So the frontend contract mostly exists (swap `mockStream.ts` for real SSE; `types.ts` gains
three types and two fields), and the Kick-native reward signals are already ingested.

---

## 5. Interventions

Grouped by what capability they need, because that decides both feasibility and who approves.

**Tier 0 — read-only, targets the streamer.** A card on the dashboard; the effect on chat is
indirect, via the streamer acting on it. Question-storm alert, lull warning, "a regular from
last week just came back". Real arms, zero API risk, cannot fail on stage.

**Tier 1 — needs `chat:write`. Confirmed available. This is the core arm set.**

| Arm | What the bot posts | Cost to participate | Who it converts |
|---|---|---|---|
| `emote_rally` | "drop a 🔥 if you saw that" | one keystroke | lurkers |
| `chat_poll` | "1) X  2) Y — type 1 or 2", tallies replies over 60s, posts the result | one keystroke + reading | semi-engaged |
| `question_relay` | surfaces a buried question with the asker's @, when several people are asking it | none for chat; rewards the asker | the engaged |
| `shoutout` | first-time chatter, or a returning regular | none | newcomers |
| `nothing` | — | — | — |

`chat_poll` is a real poll without a poll API: the bot asks, chat replies, the bot counts. Real
votes, real reaction, fully measurable.

The demo-critical arms are `nothing`, `emote_rally` and `chat_poll`. `question_relay` and
`shoutout` require an eligible chat event and may need longer outcome windows, so they are
cut before the core loop.

**Arms must be behaviourally distinct or the bandit cannot separate them in ~40 decisions.**
The axis we span is *cost of participation*, because that decides who converts. Five arms that
all cost chat the same effort would give us a demo where nothing differentiates.

**An arm is a tactic, not a phrasing.** The tempting alternative — five ways to word a poll,
generated by the LLM — fails three ways. Variants of one tactic differ by far less than tactics
do, so the separation problem above gets strictly worse. A set regenerated per decision has no
stable arm identity to hold a posterior; learning over phrasings needs a parametric bandit over
copy features, which §12 cuts. And it couples the LLM to the policy in the direction §6 forbids:
if the arms *are* LLM output, a failed call leaves nothing to select from. Phrasing is a second
level, and §12 says where it goes.

**Tier 2 — needs a native mechanic. Unverified. Stretch.** A `prediction` suggestion opens the
streamer's native flow. It stakes viewers' Channel Points, so it always requires approval.

**Tier 3 — the streamer physically does it.** "Read this out loud", "run a giveaway". Card-only.

**Stretch, gated on the context provider (§7):** `callback` — quote something a chatter said
ten minutes ago that just became relevant. Needs a transcript. The arm no timer bot can imitate.

**Cut order if behind:** `shoutout`, then `question_relay`, then native `prediction`. Two active
arms plus `nothing` tell the whole story.

---

## 6. Modules

All new files under `server/src/easy_kick/`.

```
Kick webhooks ──┐
                ├──►  EventStore ──►  engagement.py  ──►  state ∈ {lull, steady, spike}
gym.py ─────────┘        │  Hub                              │
   ▲                     │                                   ▼
   └── reacts to fire ───┤                            bandit.py (Thompson)
                         │                                   │ arm + propensity
    context.py ──────────┤                                   ▼
    (viewers, category,  │                            director.py (loop, rails,
     optional audio)     │                                        LLM copy)
                         │                                   │
                         └───────►  SSE /stream  ◄───────────┘
```

### `context.py` — stream metadata

New, small, and the best return on effort in this document. Polls `GET /channels` every 30s
for `viewer_count`, `category`, `stream_title`, `start_time`; subscribes the two new webhook
events. Three uses: viewer count turns our reward into a rate (below); category is the pooling
key for the roadmap and a category change is a rail (reset baseline, suppress fires for 60s);
uptime, because chat at minute five is not chat at hour six.

Must degrade — if the poll fails or we are in the gym, `viewer_count` is `None` and
`engagement.py` falls back to baseline normalisation.

### `engagement.py` — the observable state

Rolling windows over `EventStore`. **Nothing here may read gym internals.** It sees exactly
what it would see on live Kick traffic.

```python
unique_chatters, msgs_per_min, new_chatters, redemptions, kicks_gifted   # 60s window

participation = unique_chatters / max(viewer_count, 1)      # primary, when viewers known
breadth       = norm(participation)                          # else fall back to:
                0.4 * norm(msgs_per_min) + 0.6 * norm(unique_chatters)

state = lull | steady | spike        # by ratio to the channel's own rolling baseline
```

**Participation rate, not message volume**, for three reasons in order of importance. It is
the number a streamer has intuition about — "4% of your audience talks, we got it to 6%" is a
sentence anyone understands, "breadth lift 0.31" is not. It is comparable across channels,
which is the precondition for pooling priors across the fleet; pooling raw counts would let
large channels dominate. And it absorbs a confounder we otherwise cannot see — a raid brings
500 viewers and the message rate triples for reasons unrelated to us.

Raw msgs/min is also gameable by spam and treats 5 people flooding the same as 50 joining in.

### `bandit.py` — the policy

Thompson sampling over 5 arms × 3 states = 15 Beta posteriors. Zero dependencies.

```
select : θ_a ~ Beta(α_a, β_a) for each eligible arm; argmax; return (arm, propensity)
update : Bernoulli trick — flip a coin with p = reward, then α += hit, β += miss
decay  : α, β move toward the prior by γ (≈ 0.99), so old evidence fades
```

- **Thompson over ε-greedy/UCB.** Handles delayed, batched rewards without awkwardness, and it
  visualises — you can watch distributions narrow. ε-greedy shows nothing.
- **Three states, not seven.** 15 cells is already a lot to fill in a demo. A fourth state
  (`influx`, a raid) is the first addition if we are ahead. LinUCB over a continuous feature
  vector is a drop-in replacement once there is fleet data.
- **Do not add streamer-audio as a state dimension.** It would double us to 30 cells and make
  the demo worse. It belongs in the rails — §7.
- **Log the propensity on every decision.** Monte Carlo: ~200 posterior samples per arm, count
  how often each wins. One extra field, and it is the whole answer to "how would you iterate
  safely in production".
- **Select only from eligible arms.** Apply `off`, caps and missing-input checks before
  selection, then calculate propensity over that same set.
- **Preserve control coverage.** Keep a small minimum assignment probability for `nothing`;
  pure exploitation can otherwise remove the comparison it depends on.
- **Cold-start floor:** below 3 pulls in a cell, fall back to the prior.

With roughly 40 decisions in a stream, 15 cells will not all settle. Insights must show pulls
or uncertainty and say "early signal" when evidence is thin. Reliable cold start comes from
repeated streams and pooled priors; that is roadmap, not a hackathon claim.

### `reward.py` — scoring a closed window

```python
lift          = participation_after − participation_control  # reported in points
relative_lift = lift / participation_control                 # used for scoring
bonus         = w_k * (redemptions + kicks_gifted + follows)
r_raw         = relative_lift + bonus − fire_cost             # cost ≈ 0.05 per fire
reward        = logistic(r_raw / scale)                        # → [0, 1]
```

`fire_cost` is small and load-bearing: an intervention has to earn its interruption. It makes
`nothing` competitive and keeps the bot quiet by default. `nothing` windows score the same way
with `fire_cost = 0`.

Two control estimators, both implemented, because the comparison is the evidence:

| | Definition | Property |
|---|---|---|
| `naive` | participation in the 60s *before* the fire | Biased upward. You fire because things dipped, so mean reversion flatters you |
| `matched` | mean participation of the last K **clean** windows in the same state where nothing fired | Reduces that bias; directional on one stream, not causal by itself |

**Clean matters and is easy to miss.** Cooldown is 90s, personas respond for 30–90s after a
fire, windows are 60s — so the first `nothing` window after a fire is contaminated by the
previous intervention's tail (upward) or its fatigue (downward). Tag any window starting within
120s of a fire as `contaminated` and exclude those from the control pool only; they still count
as decisions. Do this before plotting anything, or you will spend hour four chasing an offset.

### `director.py` — the loop

```
every 5s (virtual):
    if streamer_speaking or in_category_transition: continue   # rail, NOT a decision
    state = engagement.state()
    eligible = apply_off_caps_and_input_requirements(state)
    if cooldown_active or not eligible: continue               # rail, NOT a decision
    try:     arm, propensity = bandit.select(state, eligible)
    except:  continue                                          # rail, NOT a decision
    if arm == nothing: open reward window, closing at t + 60s
    if arm is auto: fire; open reward window at fire time
    if arm is ask: emit card; wait                              # no outcome window yet

on approval:
    fire; open reward window at approval time

on fired/nothing window close:
    r = reward(state, arm, window)
    bandit.update(state, arm, r)
    emit director.result + director.bandit
```

Six things that are easy to get wrong:

- **`nothing` decisions still open a reward window.** Otherwise `nothing`'s posterior never
  updates and the arm can never win. It is a real arm and gets scored like one.
- **Rail-forced no-ops are not decisions.** Cooldown, caps, category transitions and the audio
  gate must not update any posterior — they are not policy choices, and counting them poisons
  `nothing`'s statistics.
- **Eligibility is resolved before selection.** A relay without a question, a shoutout without
  a newcomer, and any capped or disabled arm are absent from the choice set and propensity.
- **An approval window starts when the action fires.** Starting it when the card appears gives
  a slow approval less than 60 seconds of treatment and measures against stale state.
- **A dismissed card is not a fired arm.** See §7.
- **The bandit is a chooser, never a dependency.** If `select` raises — uninitialised cell,
  degenerate posterior, bug — the loop catches it and skips the tick as a rail. Every other
  module has a named degradation path (`context.py` → `viewer_count = None`, LLM → templates,
  audio → no gate); the decision itself is not the exception. The cold-start floor and the warm
  start (§13) cover a *dumb* bandit; this covers a *throwing* one.

Safety rails live outside the bandit and are not negotiable: global 90s cooldown, per-arm
hourly cap, streamer veto, kill switch. The bandit optimises within the rails, never sets them.

**The LLM writes content, the bandit picks policy.** Claude generates the poll question or
rally prompt from recent chat; templates are the fallback. A slow or failed LLM call degrades
copy and can never break the learning loop.

---

## 7. Autonomy and the human in the loop

Underbuilt in the previous draft, and it is a quarter of the judging rubric.

**Autonomy is per-arm, keyed to stakes.** One global copilot toggle is the wrong shape — the
streamer's mental model is "I trust it with the cheap stuff." Ship a three-way per arm:

| Arm | Default | Why |
|---|---|---|
| `emote_rally`, `shoutout` | `auto`, after setup consent | Spends nothing but a chat line |
| `chat_poll`, `question_relay` | `ask` → `auto` after N approvals | Occupies chat's attention |
| `prediction` | `ask`, always | Stakes *viewers'* Channel Points. Not ours to spend |

**The trust ratchet.** Higher-attention arms start in `ask`. Once an arm has N approvals and
positive observed outcomes, the UI can offer promotion: *"You've approved 8 polls; run these
automatically?"* The streamer makes that decision. Approved outcomes remain labelled
observational until the arm runs autonomously.

**Vetoes are a separate signal, and mixing them is a bug.** A dismissal tells us not that chat
would have disliked it, but that *this streamer* does not want it. If the bandit picks
`chat_poll`, emits the card, and the streamer dismisses it: do **not** update the arm's
chat-response posterior (the arm never fired; folding this in is missing-not-at-random and
poisons the arm), **do** update a separate streamer-preference counter per (state, arm), and
**void** the open window. The interesting case is disagreement — chat responds well but the
streamer kills it every time, so we stop suggesting it. That is also the complete answer to
"won't this spam my chat".

**Rails are human-set, never learned.** Max fires/hour, quiet hours, per-arm blocklist, kill
switch, surfaced as a visible settings panel. Cheap, it is what makes a streamer trust the
product, and UX is 10% of the score.

### Optional context provider — streamer audio (stretch, first thing cut)

Audio is not a substitute for randomized assignment or logged propensities. Its main value is
lower variance and better timing: a lull because the streamer is loading a map and a lull
because they are mid-way through a serious story currently land in the same bucket. At roughly
40 decisions per stream, that distinction can materially improve the signal.

So it feeds the rails and the copy generator, never the state space. Streamer mid-sentence →
gate, suppress the fire, not a decision. Streamer just asked chat something → trigger
`question_relay`, a rule rather than something to learn. Recent transcript → content generation
and the `callback` arm.

**Voice activity detection, not transcription**, for the gate: ~1% of the cost, most of the
value. **The delay decides the architecture** — Kick's HLS runs ~10–20s behind live, so VAD on
the pulled public stream arrives after the streamer has stopped talking. Fatal for a gate, fine
for a callback. Want the gate → capture OBS-side on the streamer's machine (low latency, but an
install and a moving part). Want callbacks and better copy → pull HLS with ffmpeg, lag is
harmless. Pick one; do not build both.

Build the interface, mock the provider, ship the real one only if one person owns it end to end
off the critical path. `ContextProvider` yields `{speaking: bool, recent_transcript: str}`; an
absent provider means no gate and template copy. Same discipline as the LLM — a missing feed
costs a rail, never the loop.

---

## 8. Frozen contracts

Agree these first, mock them immediately, then build in parallel. With four people and one day,
integration is the risk, not the algorithms.

**SSE — multiplex onto the existing `/stream`.** No change to `EventHub`. Director frames are
`EventEnvelope`s with synthetic types — `director.insight`, `director.action`,
`director.result`, `director.bandit`, `director.context` — whose `payload` is already the
frontend shape. `EventEnvelope.type` is a plain `str`, so these coexist with `EventType` without
touching `models.py`. `read.py::_chat_sse` grows a dispatch: chat events keep the existing path,
`director.*` events serialise `event.payload` directly, everything else is still dropped.

```ts
// client/src/types.ts
export type Arm = 'nothing' | 'emote_rally' | 'chat_poll' | 'question_relay'
                | 'shoutout' | 'prediction';
export type ChatState = 'lull' | 'steady' | 'spike';
export type Autonomy  = 'auto' | 'ask' | 'off';

// ActionEvent: add  state: ChatState;  propensity: number;  autonomy: Autonomy;
//              .kind gains the new arm names (icons in ActionFeed.tsx)

export type ActionResult = {
  type: 'result';
  action_id: string;
  votes: Record<string, number>;
  engagement_delta: number;      // matched-control lift; field name unchanged
  reward: number;                // [0,1] after squash
  lift_naive: number;            // for the estimator comparison
  lift_true?: number;            // gym only — never present on live Kick
  outcome: 'fired' | 'dismissed' | 'railed';
};

export type BanditFrame = {
  type: 'bandit'; ts: string; decisions: number;
  posteriors: { state: ChatState; arm: Arm; alpha: number; beta: number;
                mean: number; pulls: number }[];
  last_decision?: { state: ChatState; samples: Record<Arm, number>;
                    chosen: Arm; propensity: number };
};

export type ContextFrame = {
  type: 'context';
  viewer_count: number | null; category: string | null;
  participation: number;         // unique chatters / viewers
  uptime_s: number; streamer_speaking?: boolean;
};
```

| Method | Path | Purpose |
|---|---|---|
| POST | `/dev/gym?speed=&seed=&loop=` | Start the reactive gym (sim mode only) |
| GET / DELETE | `/dev/gym` | Status / stop |
| POST | `/dev/gym/speedrun?decisions=2000&seed=` | Headless run, streaming posterior snapshots |
| POST | `/dev/gym/race?seed=&policies=gambit,timer` | Forked head-to-head (§9) |
| GET | `/director/policy` | Learned policy table + generated insight sentences |
| POST | `/director/action/{id}/{send\|dismiss}` | Streamer approve / veto |
| PUT | `/director/autonomy` | Per-arm `auto`/`ask`/`off`, caps, quiet hours |
| GET | `/eval/results` | `eval_results.json` for the charts |

---

## 9. The gym, and what it does and does not prove

### `gym.py` — the reactive environment

Replaces linear replay for development and evaluation. ~200 lines, stdlib only.

```python
@dataclass
class Persona:
    name: str                                    # voices seeded from data/sample_stream.jsonl
    base_rate: float                             # msgs/min at steady state
    theta: dict[tuple[ChatState, Arm], float]    # hidden response multiplier
    fatigue: dict[Arm, float]                    # decays on repeat fires

class Gym:
    def __init__(self, seed: int, store: EventStore, hub: EventHub | None): ...
    def step(self, dt_s: float) -> list[EventEnvelope]: ...
    def fire(self, arm: Arm) -> None: ...
    def fork(self) -> "Gym": ...                 # deepcopy incl. RNG state
    def true_effect(self, arm: Arm, window_s: int) -> float:
        """participation(fired) − participation(no-op) from twin worlds. Evaluation only."""
```

About 120 personas. Archetypes keep θ interpretable: `emote_enthusiast` piles onto rallies
during spikes, `the_analyst` answers polls during lulls, `lurker` only converts on one-keystroke
arms, everyone resents an interruption mid-spike.

Easy to get wrong, expensive to fix later:

- **Own the RNG.** `self._rng = random.Random(seed)` on the instance, never module-level
  `random`. `fork()` is a `deepcopy` — with a shared global RNG the two worlds are not
  independent and every twin-world number is garbage.
- **Virtual clock, not `asyncio.sleep`.** `step(dt_s)` advances virtual time and returns events.
  The caller maps virtual → wall time at `speed×` (live) or runs flat out (headless).
- **Stamp `EventEnvelope.timestamp` with virtual time.** Engagement windows read envelope
  timestamps, not wall clock. Without this, headless mode produces 2000 decisions inside the
  same "second" and every window is empty.
- **Scripted content arc** (lull → steady → spike → settle) drives base rates independently of
  the bot. This is the confounder and it has to exist.
- **Simulate viewer count** too, so `participation` is exercised in the gym.
- **Emit through the real path**: `store.add(event)` then `hub.publish(event)`, same order as
  `routes/webhook.py`.

`/dev/replay` keeps working unchanged. The gym mounts at `/dev/gym`.

### What it proves, honestly

The bandit never sees ground truth — it trains only on the observational estimator it would use
on live Kick traffic. That separation is structural, not a promise: the gym writes
`EventEnvelope`s into the same `EventStore` real webhooks write into, and `engagement.py` reads
only from the store.

But there is a limit worth naming before a judge does. Our personas carry `theta[(state, arm)]`
and our bandit is a table over (state, arm) — world and model share a parameterisation. The
model cannot be misspecified in the gym, only wrong about values. Sampling θ across many worlds
explores the parameter space; it never leaves the structure. On real Kick chat, response also
depends on the game, on what the streamer just said, on whether the poll question was any good.

| Claim | Does the gym establish it? |
|---|---|
| The naive pre/post estimator is biased upward | **Yes.** The mechanism (fire because chat dipped → mean reversion) needs only a non-constant content arc, not our θ parameterisation |
| `matched` removes most of that bias | **In this gym.** Report as a relative simulation result, not "our live estimator is correct" |
| The bandit converges to the best arm | Circular — it converges in a world built to be converged in. Report as a best-case result under a well-specified world |
| The magnitude of lift on real Kick chat | **No.** Do not imply it |

The gym is our dev environment, test harness and demo device. The randomized assignment and
logging in §2 are the basis for stronger live estimates; the matched single-stream result is
directional.

### Evaluation artefacts

`eval/run_eval.py` is pure stdlib and dumps `eval_results.json`. Charts render in the dashboard
with Recharts (already a dependency).

1. **Head-to-head.** Fork at t=0, same seed, same personas, same arc. One world runs Gambit, the
   other a 15-minute timer. Two chat panels, two live participation counters. A demonstration of
   mechanism, not a measurement of magnitude — say so out loud. Also the clearest thing we can
   put on a screen.
2. **Estimator comparison.** Estimated lift (x) against true twin-world effect (y), one point per
   decision, `naive` and `matched` overlaid with fitted slopes. A narrow, defensible claim: here
   is a named bias, and here it is going away.
3. **Policy comparison across sampled worlds.** Gambit / random / timer / silent, mean ± 95% CI
   over ~100 sampled θ. **Report as distinct chatters per hour, not regret** — "regret" is a word
   nobody outside ML hears correctly, and a chart where lower is better reads as losing.
4. **What it learned.** 5×3 heatmap of posterior means plus evidence-aware sentences:
   *"Across six comparable lull moments, poll windows were 1.4 percentage points above quiet
   ones. During spikes, staying quiet performed best. This is an early signal."* This is the
   deliverable, not a footnote.

---

## 10. Testing

`uv run pytest -q` from `server/`, `httpx.MockTransport` for anything external, no real network.

- `gym.fork()` determinism: fork, step both 60s with no fires, assert identical event streams;
  then fire in one and assert they diverge. Same seed → same stream across instances.
- `bandit`: converges to the best arm on a toy 3-arm world within N pulls; posteriors decay
  toward the prior when evidence stops.
- `engagement`: windowing driven by envelope timestamps, verified with fabricated timestamps
  rather than sleeping. `participation` falls back correctly when `viewer_count` is `None`.
- `reward`: `matched` returns the clean control-pool mean; contaminated windows are excluded from
  the pool but still counted as decisions; `naive` returns the pre-window value; `nothing`
  windows carry no `fire_cost`.
- `director`: eligibility is resolved before selection; propensity uses that set. Approval
  starts a fresh 60s window; dismissal updates preference only. Rail-forced no-ops and a failed
  `bandit.select` open no window and update no posterior.
- `context`: a failed `GET /channels` degrades to `viewer_count = None` without raising.
- Route tests for `/dev/gym` and `/director/*` mirroring `tests/test_simulator.py`.
- The live-Kick path stays green throughout.

---

## 11. Ownership and timeline

| | Owns | Ships |
|---|---|---|
| **MLE 1** | `gym.py` — personas, θ, virtual clock, `fork()`, simulated viewer count, seed tuning so learning converges in demo time | A gym that writes real `EventEnvelope`s and forks cleanly |
| **MLE 2** | `engagement.py`, `bandit.py`, `reward.py`, `eval/run_eval.py` | 15 posteriors + `eval_results.json` |
| **BE** | `context.py`, `director.py`, `routes/director.py`, SSE multiplexing, LLM copy with template fallback, live-Kick path | Frames on `/stream` matching §8 exactly |
| **FE** | `mockStream.ts` → real SSE; streamer view; autonomy panel; head-to-head view; Bandit Brain behind a toggle; eval charts | The thing judges actually look at |

New files: `context.py`, `gym.py`, `engagement.py`, `bandit.py`, `reward.py`, `director.py`,
`routes/director.py`, `eval/run_eval.py`.

**Frontend layout.** The streamer view is the default: chat state, current suggestion, autonomy
controls, the three insight sentences. The Bandit Brain (15 Beta densities) sits behind an
"under the hood" tab. Fifteen sharpening distributions is a beautiful ML-researcher UI and a
liability against "is the experience simple to understand". Opt-in depth reads as more
impressive than depth you are forced through.

**Before the day.** Get written confirmation of what pre-built work is permitted. The public
rules describe the submission as work created during the event; without approval, keep
preparation to design notes, contracts, fixtures and rehearsal rather than submission code.

**On the day.** The public page promises 4–5 hours of focused hacking. Plan for five hours,
then treat any extra time as contingency.

| Time | Milestone |
|---|---|
| 0:00–0:20 | Confirm day-of requirements, freeze contracts, smoke-test live Kick |
| 0:20–1:20 | Gym → `EventStore`; engagement state and participation rate |
| 1:20–2:40 | End-to-end loop with `nothing`, `emote_rally` and `chat_poll` |
| 2:40–3:40 | Approval flow, control coverage and one evaluation chart |
| 3:40–4:15 | Head-to-head and one real Kick intervention |
| 4:15–5:00 | Feature freeze; rehearse live and fallback demos twice |

---

## 12. Scope

**Not building.** No database or persistence — the repo convention, and also our privacy
posture: chat is processed ephemerally, nothing stored, only aggregate counts inform the policy.
No neural or continuous-vector bandit. No sentiment model. No cross-channel priors; roadmap only.
Ghost timelines (forking every arm and rendering the unchosen ones) were considered and cut — the
head-to-head carries the same idea with less build risk.

**Cut lines, in order.** 1. Audio context provider. 2. Native prediction. 3. `shoutout` and
`question_relay`. 4. LLM copy → templates. 5. Estimator scatterplot. Keep one live Kick action,
the three-arm loop and the streamer controls.

**Roadmap, for the pitch not the build.** Hierarchical priors: global → channel archetype (keyed
on `category`) → channel, so a new channel inherits a working policy on day one instead of weeks
of cold-start exploration. Pool on normalised rates only. Off-policy evaluation over the logged
propensities. A fourth state, `influx`, for raids. A second level below the tactic: once a channel
has a settled arm ranking, the same machinery learns *phrasing* within the winning arm, with
LLM-generated variants as sub-arms. That is the right home for the copy-variant idea (§5) — it
needs sample sizes a single stream cannot produce, so it is fleet-scale work, not a hackathon
arm set.

**Privacy, if asked.** Chat passes through an LLM for copy generation; nothing is persisted, only
aggregate counts feed the policy. The streamer's own audio, if we get to it, is their broadcast on
their own OAuth-consented channel; chat messages are third parties' data, and we treat the two
differently.

---

## 13. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Webhook auto-unsubscribe on flaky venue wifi | High | Health check + auto-resubscribe; gym as fallback; recorded video as last resort |
| Posteriors don't move enough in demo time | High | Seed tuning + headless speedrun. If the live segment is warm-started, label it clearly as a prior simulated run; show learning in fast-forward |
| Predictions not firable via API | Medium | Tier 1 arms need nothing beyond `chat:write`; `prediction` was always approval-gated |
| `GET /channels` rate-limited or slow | Medium | 30s poll, cached, degrades to `viewer_count = None` |
| Audio provider eats a person's whole day | Medium | Hard-gated: interface + mock first, real provider off the critical path, first thing cut |
| Integration hell late in the day | Medium | Contracts frozen at 0:30, everyone on mocks |
| Overscoping the arm count | High | Demo-critical set is `nothing`, `emote_rally` and `chat_poll`; the rest is optional |
