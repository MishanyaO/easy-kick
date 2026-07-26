# 004 — Screen layout and widget states

Parent: [map](../map.md) · Label: `wayfinder:prototype` · Status: **closed** · Assignee: **Mike**
Blocked by: —

## Question

Build a rough, throwaway prototype of the screen to react to, then lock the layout and
every widget's state machine. Use `/prototype`.

**[008](008-surfaces-attention-budget.md) settled the surfaces**: live mode is a 360px
vertical OBS dock holding one phase-driven slot plus an ambient sparkline; review mode is
one page — timeline + ledger with a by-time / by-arm toggle. This ticket draws them, and
its "Reversible at prototype time" list is the set of 008 calls explicitly open to being
overturned here. It also now owns what a grouped ledger gives for free, inherited from
[007](007-experiment-surface.md).

Build against invented data — the contract in [003](003-event-contract.md) is deliberately
scheduled *after* this ticket and should be derived from what the prototype turns out to
need.

The widget set is largely settled by the audit — these survive:

- **Live chat** — the credibility anchor.
- **State + timeline** — the state chip driven by real detection, the timeline beneath
  it, with `hype_spike` as a marker.
- **Pace + People** (msgs/min, unique chatters) — kept only because they are literally
  the two numbers the verdict subtracts; they make the measurement legible.
- **Co-pilot feed** — suggestion → fired → measuring → verdict. The spine.
- **Experiment surface** — see [007](007-experiment-surface.md), lowest priority.

These are cut and should not reappear: hype score 0–100, sentiment/mood, trending topics,
shoutouts, and the draggable/resizable `WidgetGrid` (real cost, ~zero judged value, and a
live hazard mid-demo).

Decide:

1. **Zones and proportions.** The current 1fr / 2fr / 1fr three-column split was built
   for a dashboard centre. With the centre now much lighter, does the co-pilot become the
   centre of gravity?
2. **Where the experiment surface lives** — a second tab, a slide-over, or a panel that
   is empty until trials accumulate. It must be absent-able without leaving a hole.
3. **Every widget's states**, explicitly: cold start (no data yet), empty (data, nothing
   to show), live, and for the co-pilot card: suggested / fired / measuring / measured /
   dismissed / expired. The brief forbids ever rendering a blank panel, so each needs a
   designed empty state with copy.
4. **What the streamer sees at second zero** — the demo opens on this screen, and a
   screen full of "waiting…" is a bad first five seconds.
5. **How much of the existing snippet library survives** the cuts, and what gets deleted.

Output: the prototype linked from this ticket, plus the locked layout and state list.


## Resolution

Prototype: [client/src/prototype/](../../client/src/prototype/) — nine variants, run with
`npm run dev --prefix client` then `?proto=1&variant=F`. Full reasoning and the rejected
options are in [NOTES.md](../../client/src/prototype/NOTES.md).

**Live mode: variant F — locked.** A floating, user-positioned panel (~360px), parked over
the OBS *preview*, not docked as a column and not over chat. A→E→F is the whole argument: a
docked column wastes a permanent slot on "nothing needed"; a floating card fixes that but
covers chat when it expands; parking over the preview costs nothing because the streamer
watches the game, not OBS's preview of it. **This overturns 008's "docked column" call.**

Phases in one slot: healthy (pill + sparkline) → detected (expanded card, big type, one
button) → fired (countdown) → measured (verdict, then decays back to the pill). Sparkline
survives at 20px resting / full size expanded. 360px holds.

Movability is OBS's, not ours — an undocked panel has OBS's own title bar and the position
persists in the profile. We **cannot** place it programmatically (`window.moveTo` is blocked;
a dock is an embedded CEF view), so "park it over the preview" ships as a one-line setup
step, not enforced behaviour.

**Review mode: variant R7 — confirmed by the team, 2026-07-26.** Rows grouped by *verdict*
(the question review mode answers), state tiles that both summarise and filter, rows that
expand into state-specific detail, and the bandit on its own **Tactics** tab leading with
*what it would pick next and why* rather than with a posterior. Headline is R4's
"+N messages that would not exist" = Σ(deltaRpm × window).

Rejected with reasons: R1 (a spreadsheet), R3 (makes the bandit the thesis), R5 (too dense),
R6 (kanban columns can never balance — lull volume dwarfs debate and raid).

**Bug found and fixed in the process:** arms were being ranked across states, so a debate
tactic outranked a lull tactic on a number that only measured the state. Fixed at source in
`armStats()`; the UI now says "ranked within this state only".

**What this unblocks:** the field list the surfaces actually need is tabulated at the end of
NOTES.md and is the input to [003](003-event-contract.md). The additions the prototype
surfaced that were not in the original plan: `replies` (+ `sampleReplies`), `heldMin`,
`votes[]` with an `off-topic` bucket, and `raiders{arrived,spoke}`.

**Cleanup owed:** delete `client/src/prototype/` and the `?proto` branch in
[main.tsx](../../client/src/main.tsx) once the winners are folded into real components.


### Follow-up 2026-07-26

Team confirmed both choices. The twelve losing variants are deleted; F absorbed E (F was
E parked over the preview, nothing more). `client/src/prototype/` now holds only F, R7 and
this decision record, and is design reference rather than a live artefact — the working
implementations are `client/src/gambit/Dock.tsx` and `Review.tsx`, wired to the real
controller on `dev`.
