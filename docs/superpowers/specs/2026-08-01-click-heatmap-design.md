# Click-density heatmap over Stream Preview

**Date:** 2026-08-01
**Status:** Approved, ready for planning
**Branch:** `feat/video-placeholder`

## Summary

Add a toggleable, accumulating click-density heatmap that overlays the Stream
Preview panel while the stream is live. Clicks are **mocked** on the client —
generated over time in believable hotspot clusters — so the streamer sees
attention build up on the video. No backend, no viewer page, no ties to the
co-pilot loop. Fully self-contained on the existing streamer dashboard.

This grew out of the original ask ("users click on the video and the streamer
sees an overlay"): the concrete form is a heatmap of click density, driven by
mock clicks, with a real click on the preview also contributing a point.

## Context

The app is a Kick streaming co-pilot (`server/` FastAPI + `client/` React over
SSE). The dashboard replicates `dashboard.kick.com/stream` and is the streamer's
surface. There is no real video source, so `StreamPreview` fills its body with a
banner — the offline banner normally, and (as of the prior change) a looping
`video-placeholder.mp4` while the gym is running (`gymOn`).

The heatmap layers on top of that video, over the existing absolute-fill pattern.

## Decisions (from brainstorming)

- **Behavior:** Accumulating — clicks pile up and stay, the map gets denser over
  the session. No per-point fade. Resets when the stream restarts.
- **Visibility:** Toggle button (a `🔥` PanelButton in the Stream Preview header).
  Off by default; only meaningful while live.
- **Data source:** Mock clicks generated client-side, clustered. A real click on
  the preview also adds a point (honors the original "click on the video"
  framing).
- **Rendering:** Hand-rolled canvas heatmap, no new dependency. Standard two-pass
  technique (alpha blobs → color LUT). The client currently depends only on
  `react` + `lucide-react`; a heatmap library would add a dep for ~120 lines we'd
  mostly reimplement.

## Architecture

Three pieces, each independently understandable.

### 1. `useClickHeatmap(active: boolean)` — data owner

`client/src/kick/useClickHeatmap.ts`

- Holds clicks as an array of `{ x: number; y: number }` in **normalized `[0,1]`
  coordinates**, so points survive panel resizes (the preview is not a fixed size).
- While `active`, a `setInterval` emits **mock clicks** in small batches (a few
  per tick). Clicks cluster around a handful of "hotspot" centers (each a random
  point that drifts slowly) plus scattered uniform noise, so the accumulated map
  reads as attention blobs rather than uniform fill.
- **Accumulates** — never fades. Capped at `MAX_POINTS` (~4000) to bound redraw
  cost; once capped it stops adding new points. The cap is documented in a
  comment, not a silent truncation.
- **Resets** to empty when `active` transitions false→true (a new stream run),
  matching the "resets on restart" decision. Also clears the timer when `active`
  is false.
- Returns `{ points: Point[]; addClick(nx: number, ny: number): void }`.
  `addClick` is used by the real-click handler; it appends one normalized point.

Randomness uses `Math.random()` (standard browser API; fine in app code).

### 2. `Heatmap` — pure canvas renderer

`client/src/kick/Heatmap.tsx`

- Props: `points: Point[]`, `className?: string`. Renders a `<canvas>` that
  absolutely fills its parent.
- Redraws when `points` changes and when the element resizes (`ResizeObserver`).
  No React state per point — points come in as a prop, drawing is a side effect.
- Two-pass draw:
  1. **Alpha pass:** for each point, draw a radial gradient blob (opaque center →
     transparent edge) at `x * width, y * height` with a fixed radius, accumulating
     coverage.
  2. **Colorize pass:** read `ImageData`, map each pixel's alpha through a 256-entry
     gradient lookup table (blue → cyan → green → yellow → red) to set RGB, keeping
     alpha for a translucent overlay.
- Device-pixel-ratio aware so the map isn't blurry on retina.

### 3. `StreamPreview` — wiring

`client/src/kick/StreamPreview.tsx` (modified)

- Local `const [heatmapOn, setHeatmapOn] = useState(false)`.
- `const { points, addClick } = useClickHeatmap(gymOn)`.
- New `🔥` toggle `PanelButton` in `actions`, before the existing popout button.
- When `gymOn && heatmapOn`, render `<Heatmap points={points} />` absolutely over
  the video.
- The video/preview wrapper gets an `onClick` that converts the event's position to
  normalized coords (via `getBoundingClientRect`) and calls `addClick` — only while
  live.

### `PanelButton` extension

`client/src/kick/Panel.tsx` (modified)

`PanelButton` is currently a plain non-interactive button. Add two optional props:

- `onClick?: () => void`
- `active?: boolean` — when true, apply the "on" styling (e.g. white text /
  elevated background) so the toggle reads as engaged.

Existing call sites pass neither and are unaffected.

## Data flow

```
gymOn (from KickDashboard: gym.status === 'running')
  │
  └─▶ StreamPreview
        ├─ useClickHeatmap(gymOn) ──▶ points, addClick
        │      └─ mock-click timer (while gymOn), reset on new run
        ├─ heatmapOn (local toggle, 🔥 button)
        ├─ onClick(preview) ──▶ addClick(nx, ny)
        └─ {gymOn && heatmapOn} ? <Heatmap points={points} /> : null
```

Nothing crosses the network. The SSE stream, reducer (`useGambit`), bandit, and
controller are untouched.

## Error handling / edge cases

- **Resize:** normalized coords + `ResizeObserver` redraw. No stale pixel coords.
- **Toggle off / not live:** `Heatmap` unmounts; canvas work stops. Timer stops
  when `active` is false.
- **Point cap:** stop adding at `MAX_POINTS`; documented in comment.
- **Retina:** scale canvas by `devicePixelRatio`.
- **StrictMode double-invoke (dev):** effects must clean up their interval and
  observer so the double mount doesn't leak timers or double the click rate.

## Testing / verification

The client has no test harness set up (no test script/deps in `client/package.json`),
so verification is manual, consistent with the rest of the client:

- `pnpm dev:simulator`, start Training, confirm the video loops.
- Toggle `🔥`: heatmap appears; density visibly accumulates into hotspots over ~30s.
- Click the preview: a point lands under the cursor.
- Resize the window / panel: the heatmap stays aligned to the video.
- Stop and restart the stream: the heatmap clears and rebuilds.
- Toggle off: overlay disappears, video unaffected.
- `tsc --noEmit` passes.

## Out of scope (YAGNI)

- No backend endpoint, no real viewer-facing page, no persistence.
- No real per-region analytics, counts, or click history readout.
- No fade/decay mode (accumulating only, per decision).

## Files

- `client/src/kick/useClickHeatmap.ts` — new
- `client/src/kick/Heatmap.tsx` — new
- `client/src/kick/StreamPreview.tsx` — modified
- `client/src/kick/Panel.tsx` — modified (`PanelButton` gains `onClick`, `active`)
