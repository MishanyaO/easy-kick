# 008 — Surfaces and the attention budget

Parent: [map](../map.md) · Label: `wayfinder:grilling` · Status: **closed** · Assignee: **Mike**
Blocked by: —

## Question

The streamer is playing CS or WoW while this runs. He is not looking at our app. Most
streamers have a second monitor, so there are pixels available — but a mid-match glance
is about one second, twice a minute, and one second holds roughly **one** thing.

Settled already (standing constraint 8): **two densities of the same app, live mode as
the default.** This ticket fixes what that actually means.

Decide:

1. **What live mode is physically.** A slim always-on-top strip, a corner card, a browser
   window sized to sit beside OBS, or an OBS dock. Each implies a different width and a
   different minimum legible font size.
2. **What live mode may contain — the hard budget.** Working assumption: the state chip
   plus one suggestion with one button, and nothing else. Anything proposed beyond that
   has to justify itself against the one-second glance. Does the fired/measuring state
   stay in live mode, or does it collapse back to silent and surface only in review?
3. **The resting state.** Dark and silent while chat is healthy is the proposal — the app
   earns attention rather than demanding it. Confirm, and decide what "healthy" looks
   like: fully dark, or a minimal pulse proving it's alive.
4. **How it demands attention when a state fires.** Colour pulse only, motion, sound?
   Sound is powerful and dangerous — it goes out on the stream.
5. **The single-screen streamer.** Always-on-top over the game, a hotkey to summon, or
   accept that he checks between matches. This case is the stress test, not an edge case.
6. **What review mode is, and how you get there.** One click from live mode, a separate
   route, or a second window. And whether
   [the experiment surface](007-experiment-surface.md) is a panel *inside* review mode or
   simply *is* review mode — resolving that may collapse the two tickets.
7. **Which mode the demo opens in**, and where the switch happens in the run of show. The
   proposed ordering is: game window + slim bar → chat dies → pulse → tap → message lands
   → *then* expand to review for the verdict and the experiments.

Output: the two surfaces defined tightly enough that
[004](004-screen-layout.md) can draw layouts against them.


## Resolution

**1. Live mode is a vertical OBS custom browser dock, ~360px wide.** Physically it is one
responsive narrow route of the same web app — no native packaging, no second app. Framing
it as an OBS dock costs nothing and lands the product inside the tool the streamer already
has open, which is also the answer to the single-screen case (OBS docks undock into
floating windows). Rejected: Electron/Tauri always-on-top (packaging cost), horizontal
strip (truncates generated copy, which is the one thing he must read before tapping).

**2. Live mode is one slot with phases, not a layout with regions**, plus an ambient
sparkline. The slot shows exactly one thing, determined by the loop's phase:

| Phase | Slot shows |
|---|---|
| healthy | resting line — last verdict, dimmed |
| state detected | state + generated copy + Send / Dismiss, border pulsing |
| fired | "sent · measuring 1:12" + countdown, quiet |
| measured | "msgs/min 15→38 · **Worked**", emphasized, then decays to resting |

The verdict therefore appears in **live mode**, not only in review. If the payoff lived
only in review, the streamer would never see the thing the whole pitch is about, and the
demo would have to switch surfaces to reach it.

Beneath the slot: a thin msgs/min sparkline with state shading and `hype_spike` markers.
It is peripheral-vision content — shape, not text — so it costs no glance budget, and it
makes the state chip trustworthy rather than magic: he can see the dip that produced
"lull". Nothing else. The ledger requires reading and belongs in review.

Reinforced by [002](002-kick-chat-send-research.md): Kick has **no pin**, so the fired
prompt scrolls away in chat within seconds. The dock is the only place a fired action
persists, which independently justifies keeping fired/measuring in the slot.

**3. Resting state: not fully dark.** The sparkline is moving, so it is itself the
proof-of-life — no separate heartbeat dot is needed. A dimmed state label and the decayed
last-verdict line are enough.

**4 & 5. Visual only. No sound, not even as a toggle.** A lull is a *minutes-long
condition*, not a millisecond event, so the latency budget is ~30s, not ~1s. The design
goal is therefore **be unmistakable when he next looks**, not interrupt him — persistence
over urgency. The border stays lit until he acts or the suggestion expires. Two-monitor
streamers see it in seconds; single-screen streamers see it between rounds, still well
inside the window where the action is worth taking. Sound is rejected outright: alert
audio on a streaming rig normally goes out on the broadcast, private routing is a
per-streamer audio-config problem unsolvable on the day, and a half-built toggle is a
demo liability.

Consequence: **the cooldown doubles as the expiry.** An unacted suggestion decays visibly
rather than going stale, so he never fires a prompt for a lull that ended four minutes ago.

**6. Review mode is one page, and the experiment surface is a grouping of it, not a
separate panel.** Review mode is: the timeline across the top, and beneath it the ledger
of fired actions with their before/after numbers — with a **by-time / by-arm** toggle.
Grouped by time it is a history; grouped by arm it *is* the bandit view. Same data, two
groupings.

This is the strongest available framing for the bandit: it stops being a bolted-on ML flex
and becomes the obvious consequence of having kept a ledger. It also collapses most of
[007](007-experiment-surface.md), which is re-scoped to own only the convergence chart and
the explore/exploit surfacing.

Entry: one click from the dock. Review mode is the same app at a wide viewport.

**7. The demo opens in live mode** — game window plus the slim dock, chat dies, border
pulses, tap, message lands in chat. Only then expand to review for the verdict history and
the by-arm view. Showing that it fits real life *before* showing that it has depth is the
harder-to-argue-with ordering.

### Reversible at prototype time

Called on recommendation, not conviction; revisit against the real artifact in
[004](004-screen-layout.md): the sparkline's presence and height, whether the measured
phase decays or persists, dock width (360px is a starting point, OBS docks are
user-resizable), and the by-time/by-arm toggle vs two separate views.
