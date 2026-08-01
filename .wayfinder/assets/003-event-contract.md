# Event contract v2 — aligned to Gambit

**v1 is withdrawn.** It defined `metrics` / `state` / `suggestion` / `verdict`, written
before PR #5 landed. That PR (merged to `dev`, 2026-07-25) ships a working controller,
bandit, reward book and gym, and defines its own SSE frames in
`notes/gambit-engineering.md` §8. **Two contracts cannot both ship**, and his has running
code and tests behind it, so this document adopts his frame names and folds in the four
fields our prototype found were missing.

The delta from his §8 is marked **[added]** throughout. Nothing here renames or reshapes
anything he already emits.

## Rules (unchanged from v1, all still hold)

1. **One stream.** `controller.*` frames multiplex onto the existing `/stream` SSE as
   `EventEnvelope`s with synthetic types. No change to `EventHub`.
2. **Never guess a field.** Anything unknowable is `null`, not a plausible default.
3. **Every generated string has a fallback.** LLM writes copy; templates on failure. A slow
   or failed LLM degrades copy and never breaks the loop.
4. **One adapter** for foreign event shapes — the day-of dataset is one function.
5. **Timestamps ISO-8601 UTC. Durations carry the unit in the name.**

## Frames

Per his §8: `controller.insight`, `controller.action`, `controller.result`,
`controller.bandit`, `controller.context`.

```ts
export type Arm = 'nothing' | 'emote_rally' | 'chat_poll' | 'question_relay'
                | 'shoutout' | 'prediction';
export type ChatState = 'lull' | 'steady' | 'spike';
export type Autonomy  = 'auto' | 'ask' | 'off';
```

### `controller.action` — his shape, plus:

```ts
expires_in_s: number;   // [added] the cooldown doubles as expiry; the card must decay
                        // visibly rather than going stale. Without this the UI cannot
                        // distinguish "still actionable" from "the lull ended 4 min ago".
```

### `controller.result` — his shape, plus:

```ts
// his fields: action_id, votes, engagement_delta (matched lift), reward, lift_naive,
//             lift_true? (gym only), outcome: 'fired' | 'dismissed' | 'railed'

label: VerdictLabel | null;   // [added] UI vocabulary over his numbers — see below
contaminated: string | null;  // [added] plain-words reason when label is "Can't tell"
replies: number;              // [added] replies to OUR message via `replies_to`
sample_replies: string[];     // [added] up to ~5, for the expanded row
held_s: number;               // [added] seconds the lift stayed above the control
raiders: { arrived: number; spoke: number } | null;  // [added] raid conversion
```

`votes` already exists in his shape; the UI additionally needs an **`off-topic` bucket**
in it, because that bucket is what makes a poor poll legible instead of mysterious.

### `controller.context` and `controller.bandit` — taken as-is

`participation`, `viewer_count`, `category`, `uptime_s` and the 15 posteriors need no
changes. The Tactics surface renders `posteriors[]` directly.

## Verdict labels — a UI layer, not a model change

His reward is a number in `[0,1]`; his lift is in participation points. Neither is
something to put in front of a streamer. These four labels are derived **in the UI** from
fields he already emits — the backend does not need to compute them, though it may:

| Label | Derived from |
|---|---|
| `Worked` | matched lift positive beyond threshold |
| `Neutral` | lift inside the noise band |
| `Backfired` | matched lift **negative** beyond threshold |
| `Can't tell` | the window was tagged `contaminated` |

`Backfired` must exist: without it the product only reports good or indifferent news, and
any aggregate ignoring negatives is marketing rather than measurement. `Can't tell` maps
exactly onto his `contaminated` tag — he and this map arrived at the same concept
independently, which is a good sign for both.

Rejected `Failed`: it collides with send failure, and Kick's rate limits are undocumented
so 429s are real. `Backfired` is unambiguously about chat's response.

Cut points remain owned by [005](../tickets/005-verdict-semantics.md).

## Chat-event fields still worth adding

From [002](../tickets/002-kick-chat-send-research.md), not present in his spec:

```ts
user_id: string;            // the safe key for unique-chatter counting; username is NOT
sub_months: number | null;  // badge `count` — a real raid discriminator
replies_to: string | null;  // parent message id — direct attribution, and the input to
                            // `replies` / `sample_replies` above
```

`replies_to` is the highest-value of these: chat replying to *our* message is stronger
evidence than any window delta, and it costs nothing because Kick already sends it.

**Also a live bug:** emote names parse from `[emote:<id>:<NAME>]` in `content`, not from
`payload.emotes`, which carries only `emote_id` and `positions`.

## What this costs him

Six added fields on `controller.result`, one on `controller.action`, three on the chat
event, and an `off-topic` bucket in `votes`. No renames, no reshaping, no new frame types.
