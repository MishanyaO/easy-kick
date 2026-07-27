# 005 — Verdict semantics and thresholds

Parent: [map](../map.md) · Label: `wayfinder:grilling` · Status: **open** · Assignee: _unclaimed_
Blocked by: [003](003-event-contract.md)

## Question

The verdict is the differentiator and the thing the pitch leads with, so its semantics
have to survive a technical judge poking at them. Currently it is `Math.random()` in
[client/src/App.tsx:64](../../client/src/App.tsx) — that must die.

Decide:

1. **What separates Worked / Neutral / Too noisy.** These are plain labels over
   `deltaRpm` and `deltaUnique` with no statistics — so what are the actual cut points,
   and are they absolute or relative to the channel's baseline? "Too noisy" needs a
   defensible definition, not a catch-all.
2. **Which metric headlines which state.** `lull` should headline rpm; `raid_wave`
   should headline unique chatters, because that is what a raid converting looks like.
   Confirm, and decide whether the card shows one headline metric or both every time.
3. **The measuring state.** A verdict takes 4 minutes of stream time to exist. What does
   the card show at second 30 — a countdown, a provisional number, or both? A provisional
   number that later flips from Worked to Neutral on stage would be worse than a
   countdown.
4. **Confounds.** If a second action fires inside the after-window, or the stream state
   changes for unrelated reasons, the delta is not attributable. Does the card say so, or
   does the cooldown rule (1 action / 3 min) make this impossible by construction? Check
   the arithmetic against a 2+2 minute window — a 3-minute cooldown does *not* protect a
   4-minute measurement.
5. **`reward` for the bandit.** Is it the raw delta, a normalized value, or the verdict
   label mapped to a number? The bandit needs it comparable across states and across
   sessions.
6. **The degraded form.** If the clock beats the build, the verdict falls back to a plain
   history log — "fired lull prompt at 14:32, msgs/min 15→38" — raw before/after, no
   labels. Confirm this is the fallback and that the raw numbers are protected even if
   the styling is cut.


## Revision 2026-07-27 — mostly answered by PR #5; two things left

Re-read against `server/src/easy_kick/reward.py`, which did not exist when this was
charted. Most of the six questions are now settled *in code*, and re-deciding them would
be relitigating a merged implementation:

- **Q1 cut points** — still open, and now the only real question. `labelFor()` in
  [client/src/types.ts](../../client/src/types.ts) maps `engagement_delta` to the four
  labels through `NOISE_BAND = 0.005` (half a participation point), commented in the file
  as a placeholder waiting on this ticket. It is a frontend-only constant: the backend
  never sends a label. Decide the number, or decide it should be relative to the channel's
  own drift (`RewardBook._drift` already computes that per state).
- **Q2 headline metric** — moot. Participation rate is the single metric (map note 13);
  there is no rpm/unique split left to choose between.
- **Q3 measuring** — answered by [008](008-surfaces-attention-budget.md): countdown, never
  a provisional number. Window is 60s (`WINDOW_S`), not 2+2.
- **Q4 confounds** — answered, and the arithmetic works out: cooldown is 90s, the window
  is 60s, and `CONTAMINATION_S = 120.0` marks any window opening within 120s of a fire.
  Contaminated windows still count as decisions but are excluded from the control pool.
- **Q5 reward** — answered: relative lift against a matched control, plus a bonus term,
  minus `FIRE_COST`, squashed through a logistic with `SCALE = 0.15`. Comparable across
  states and sessions by construction.
- **Q6 degraded form** — protected. `ResultFrame` carries `engagement_delta`,
  `lift_naive` and `reward` as raw numbers; losing the styling cannot lose them.

**The second thing left, and it is a bug not a decision:** `Window.contaminated` is
computed in `reward.py` and never leaves the backend — `ResultFrame` has no
`contaminated` field on the wire (noted in `types.ts`). So the frontend's `Can't tell`
label is currently only reachable via `outcome === 'dismissed'`, and a window we *know*
was unattributable renders as a confident `Worked` or `Backfired`. Contract v2 already
specifies the field. Getting it emitted is a one-line change on each side and it is worth
more than the cut points are.

**Narrowed scope:** pick `NOISE_BAND`, and get `contaminated` onto the wire. Everything
else here is closed.


## Progress 2026-07-27 — `contaminated` ships; only the cut point is left

The bug named in the revision above is fixed, and it turned out to have **two** causes, not
one. `Outcome` now carries a plain-words `contaminated` reason and a `controls` count, both
emitted on `controller.result`:

1. **A fire inside the shadow** — "another action fired less than 120s before this window
   opened, so chat was still responding to that one".
2. **No control at all** — "no quiet `steady` windows recorded yet, so there is nothing to
   compare against — this is the before/after number, not a lift". This case was never
   discussed and is the more dangerous of the two: with an empty pool `_drift` returns 0, so
   `lift` silently *equals* `lift_naive` — the biased estimator wearing the matched label.

`labelFor` returns `Can't tell` whenever a reason is present, and Review renders the reason
under the row. Verified live: a **+2.4 pts** shoutout window that previously would have
read `Worked` is now grouped under `CAN'T TELL`, with the reason on screen.

That leaves **one** open question on this ticket: the value of `NOISE_BAND`. Still a
placeholder at 0.005, still frontend-only, and now the only thing standing between the
verdict labels and being fully defensible.
