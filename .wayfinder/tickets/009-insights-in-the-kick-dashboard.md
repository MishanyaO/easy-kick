# 009 — Where Insights lives inside the Kick dashboard replica

Parent: [map](../map.md) · Label: `wayfinder:task` · Status: **closed** · Assignee: **Mike**
Blocked by: —

## Question

PR #7 rehoused the live surfaces inside a replica of `dashboard.kick.com/stream`, which
is a better demo frame than the invented one — the judge sees the tool the streamer
already has open. But it bought the frame by **deleting a Kick panel**: Insights was
dropped into the Mod Actions slot, so the replica no longer looks like the thing it is
replicating, and our surface read as one more Kick panel rather than as ours.

That also quietly overturned [004](004-screen-layout.md)'s locked call — live mode is a
*floating, user-positioned panel*, not a docked column — without the argument being had.

Decide: what goes in the Mod Actions slot, where Insights lives instead, and how the
analytics get reached from a surface that must stay one-glance.

## Resolution

**1. Mod Actions is restored, verbatim and inert.** `client/src/kick/ModActions.tsx`,
built from Kick's own markup (`mod.html`), including the panel-header glyph now in
`icons.tsx`. It renders Kick's empty scroll viewport, because Kick's own is empty until a
mod acts. The replica is only worth having if it is a replica.

**2. Insights is a floating drawer, which restores 004's call.** `InsightsDrawer.tsx`:
360px, dragged by its header, position persisted in `localStorage`, collapsible to its
header. It is not a dock — nothing reserves a column for "nothing needed" — and not
modal, so chat stays readable underneath. Default parking spot is over the Stream
Preview, for 004's reason: the streamer watches the game, not OBS's preview of it.

**3. The drawer holds live mode only.** One phase-driven slot (`LivePanel`, docked
variant). Analytics and Tactics are one click away, not in the drawer — the attention
budget from [008](008-surfaces-attention-budget.md) is unchanged by having more pixels
available.

**4. The header's popout opens `?insights` in a new tab** — `InsightsPage.tsx`, the
Review surface at full viewport with its Actions / Tactics tabs. This mirrors Kick's own
popouts (`dashboard.kick.com/popout/<channel>/<panel>`) and costs nothing: the query-param
routing already existed in `main.tsx`, and both tabs subscribe to the same `/stream` SSE.

**5. Filter buttons are gone from every panel.** They were chrome copied for fidelity
that does nothing when clicked. A dead control on a demo screen is a liability, and Kick's
own filter is not what a judge will reach for.

### Two things found while building

- **Kick's nav is `z-402`.** A drawer at `z-50` loses its grab handle behind the navbar
  whenever it is parked near the top of the screen. It sits at `z-500` now.
- **Clamping against an unmeasurable viewport pins the drawer to the corner** — an
  embedded or offscreen host can report `innerWidth === 0`, and the clamp then wrote
  `{8, 8}` to `localStorage` as if the streamer had chosen it. `viewport()` returns null
  rather than zero, and an unmeasurable viewport skips clamping instead of collapsing it.

### Open, deliberately

The drawer's **detected** phase expands well past its resting height, and nothing checks
that it still fits below its parked position. The clamp runs on drag and on resize, not
on phase change. Worth a look before the demo; not worth solving blind.
