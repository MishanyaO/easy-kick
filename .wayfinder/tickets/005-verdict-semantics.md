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
