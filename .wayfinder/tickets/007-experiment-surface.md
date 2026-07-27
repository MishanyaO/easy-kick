# 007 — Convergence chart and explore/exploit

Parent: [map](../map.md) · Label: `wayfinder:prototype` · Status: **open** · Assignee: _unclaimed_
Blocked by: [004](004-screen-layout.md), [005](005-verdict-semantics.md)

## Question

The bandit cannot visibly learn inside a live 4-minute demo — two or three fires over
three arms converges on nothing, and claiming otherwise invites a technical judge to
call it. So the bandit gets a second surface, fed by fast replay, where hundreds of
trials accumulate and convergence is actually demonstrable.

The LLM engineer owns the bandit logic; this ticket owns the surface. In scope but
lowest priority — built after the live loop works end to end.

**Re-scoped by [008](008-surfaces-attention-budget.md).** Review mode is one page —
timeline + ledger with a by-time / by-arm toggle — and the by-arm grouping *is* the
experiment surface. So questions 1, 4 and 5 below are now owned by
[004](004-screen-layout.md); this ticket keeps only the convergence chart and the
explore/exploit surfacing, which are the parts a grouped ledger does not give for free.

Build a rough prototype, then decide:

1. **What the panel shows.** Per state, per arm: trials, mean reward, and the current
   posterior or confidence. What does "this channel responds better to callouts than to
   open questions" look like at a glance?
2. **Convergence over time, or just current standings?** A chart of arms separating over
   trials is the more compelling artifact and is the thing worth 10× replay; a leaderboard
   is cheaper and less persuasive.
3. **Explore vs exploit, made visible.** When the system picks a less-proven arm on
   purpose, does the live suggestion card say so ("trying variant B — least data")? That
   line is what turns the bandit from a hidden algorithm into a visible product idea.
4. **Where trials come from.** Fast replay only, or does the live loop's single fire also
   land here? It should — one honest trial appearing in the ledger during the demo is the
   link between the two surfaces.
5. **The empty state.** With zero trials this panel is blank, which the brief forbids.
   What does it say before any experiment has run?
6. **The fallback.** Standing constraint 5: the bandit never gates the live path. Confirm
   what the surface shows when arm selection is unavailable and the loop is running on
   first-variant fallback.


## Revision 2026-07-27 — half of it is built; keep the half that is not

`TacticsTab` in [client/src/components/Review.tsx](../../client/src/components/Review.tsx)
ships against the live `bandit` frame, and it answers more of this ticket than the
re-scope from [008](008-surfaces-attention-budget.md) expected:

- **Q1 (what the panel shows)** — done. Per state, per arm: posterior mean, pulls,
  untried arms drawn as hollow dots, and a `LEADING HERE` card. Ranked within a state
  only, which was the bug [004](004-screen-layout.md) found.
- **Q5 (empty state)** — done: "No decisions yet — the bandit publishes its table after
  the first one."
- **Q6 (fallback)** — the surface reads `s.bandit`, which is null until the first
  decision, and renders the empty copy rather than a hole. Confirm that also covers
  arm selection failing *mid-session*, which is a different code path from never having
  started.

**What is left, and it is the compelling half:**

2. **Convergence over time.** Nothing anywhere plots arms separating across trials. This
   needs the gym (`gym.start(...)`, already wired to the Stream info panel) and a series
   the backend does not currently emit — posteriors arrive as a snapshot, with no history.
   Decide whether the frontend accumulates the snapshots it sees or the backend keeps
   the series.
3. **Explore vs exploit, made visible.** Partially there and unlabelled: the drawer prints
   `picked with p=0.42`, which is the propensity and means nothing to a viewer. The
   product idea is the sentence — "trying `chat_poll` here, least data in `lull`" — and
   `bandit.last_decision.samples` carries what is needed to write it.
4. **Q4 (where trials come from)** — confirm the live loop's single fire lands in the same
   ledger as replayed ones. It should; verify rather than assume.

**Still open, still lowest priority**, and now unblocked in practice: the Tactics tab
exists, so this is an addition to a working surface rather than a surface to invent.


## Progress 2026-07-27 — Q3 shipped

The suggestion card no longer prints `picked with p=0.19`. It says which move this is:

- **EXPLORING** — "first time trying `chat_poll` in a lull", or "trying `chat_poll`
  (2 tries) over `emote_rally` (9) — still learning".
- **BACKING THE LEADER** — "`emote_rally` leads in a lull — 0.71 over 9 tries".

Derived entirely client-side (`whyThisArm` in `types.ts`) from the `bandit` frame the UI
already receives, so it returns null and the card falls back to the propensity rather than
inventing a reason — standing constraint 5, the bandit never gates the live path.
Verified live: "EXPLORING · first time trying chat_poll in a lull".

Remaining on this ticket: **the convergence chart** (Q2) — still needs a posterior *series*
the backend does not emit; posteriors arrive as a snapshot with no history. And Q4, confirm
the live loop's fire lands in the same ledger as replayed ones.
