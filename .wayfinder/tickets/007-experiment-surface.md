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
