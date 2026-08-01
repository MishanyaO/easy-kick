# Click-Density Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable, accumulating click-density heatmap that overlays the Stream Preview video while the stream is live, fed by mock clicks (and real clicks on the preview).

**Architecture:** A `useClickHeatmap(active)` hook owns click points in normalized coordinates and drives a mock-click timer while live. A dependency-free `Heatmap` canvas component renders those points via a two-pass (alpha blobs → color LUT) technique. `StreamPreview` wires a `🔥` toggle and overlays the heatmap when live and enabled. `PanelButton` gains optional `onClick`/`active` props for the toggle.

**Tech Stack:** React 18, TypeScript, Tailwind v4, HTML Canvas 2D. No new dependencies.

## Global Constraints

- **No new dependencies.** Client depends only on `react`, `react-dom`, `lucide-react`. Hand-roll the heatmap.
- **No test harness exists** in `client/`. Verification per task = `tsc --noEmit` passes + a concrete manual check in the running app (`pnpm dev:simulator`, Training → Start).
- **Coordinates are normalized `[0,1]`** everywhere they cross a component boundary, so points survive resize.
- **Randomness:** use `Math.random()` (standard browser API; app code, not a workflow script).
- **Effects must clean up** their interval/observer (React 18 StrictMode double-invokes effects in dev — no leaked timers, no doubled click rate).
- **Follow existing style:** functional components, Tailwind classes, CSS vars from `src/theme/tokens.css` (`--kick-green`, `--bg-elevated`, `--text-secondary`), thoughtful comments matching neighboring files.
- **Working directory:** `client/` for `tsc`/`pnpm`; repo root for `git`.

---

### Task 1: Extend `PanelButton` with `onClick` and `active`

`PanelButton` is currently a non-interactive button. The heatmap toggle needs it to fire a handler and show an "engaged" state. Existing call sites pass neither prop and must be unaffected.

**Files:**
- Modify: `client/src/kick/Panel.tsx` (the `PanelButton` export at the bottom)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `PanelButton({ label, children, onClick?, active? }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean })` — when `active` is true it renders with `--kick-green` text; when a handler is passed it fires on click.

- [ ] **Step 1: Update `PanelButton`**

Replace the existing `PanelButton` function in `client/src/kick/Panel.tsx` with:

```tsx
/** The small icon buttons Kick puts in panel headers. Inert by default; pass
 *  `onClick` to make it act, and `active` to show it as engaged (a toggle that
 *  is currently on). */
export function PanelButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={onClick ? active : undefined}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded transition-colors hover:bg-[var(--bg-elevated)] hover:text-white ${
        active ? 'text-[var(--kick-green)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Verify types and no regressions**

Run (in `client/`): `npx tsc --noEmit`
Expected: exits 0, no errors. Existing `PanelButton` call sites (StreamPreview, KickDashboard, Chat panel) still compile since both new props are optional.

- [ ] **Step 3: Commit**

```bash
git add client/src/kick/Panel.tsx
git commit -m "feat(panel): PanelButton accepts onClick and active state"
```

---

### Task 2: `useClickHeatmap` hook (mock-click data owner)

Owns the accumulating point array, generates clustered mock clicks while active, resets on a new run, and exposes a way to add a real click.

**Files:**
- Create: `client/src/kick/useClickHeatmap.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export type Point = { x: number; y: number }` — normalized `[0,1]`.
  - `export function useClickHeatmap(active: boolean): { points: Point[]; addClick: (nx: number, ny: number) => void }`.

- [ ] **Step 1: Write the hook**

Create `client/src/kick/useClickHeatmap.ts`:

```ts
import { useEffect, useRef, useState } from 'react';

/** A click location in normalized [0,1] coordinates, so points stay correct
 *  across resizes of the preview they are drawn over. */
export type Point = { x: number; y: number };

/** Accumulate before the map is considered "full". Bounds redraw cost — a few
 *  thousand blobs is plenty of density; past this we stop adding rather than
 *  silently drop points or grow unbounded. */
const MAX_POINTS = 4000;

/** How many mock clicks arrive per tick, and how often. */
const CLICKS_PER_TICK = 3;
const TICK_MS = 350;

/** Number of drifting hotspot centers the mock audience clusters around. */
const HOTSPOTS = 4;
/** Fraction of mock clicks that are uniform noise rather than near a hotspot. */
const NOISE_FRACTION = 0.25;
/** Spread of a click around its hotspot center (std-dev-ish, in normalized units). */
const CLUSTER_SPREAD = 0.06;
/** How far a hotspot drifts per tick, so the map isn't perfectly static. */
const HOTSPOT_DRIFT = 0.01;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A random hotspot center kept away from the very edges. */
function randomHotspot(): Point {
  return { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 };
}

/**
 * Owns the click-density data for the Stream Preview heatmap.
 *
 * While `active`, a timer emits mock clicks: most cluster around a handful of
 * slowly drifting hotspots, the rest are scattered noise, so the accumulated
 * map reads like where an audience is looking rather than uniform static.
 * Points accumulate (never fade) and reset whenever `active` goes false→true —
 * i.e. a fresh stream run starts. `addClick` lets a real click on the preview
 * contribute a point too.
 */
export function useClickHeatmap(active: boolean): {
  points: Point[];
  addClick: (nx: number, ny: number) => void;
} {
  const [points, setPoints] = useState<Point[]>([]);
  const hotspotsRef = useRef<Point[]>([]);

  const addClick = (nx: number, ny: number) =>
    setPoints((prev) =>
      prev.length >= MAX_POINTS ? prev : [...prev, { x: clamp01(nx), y: clamp01(ny) }],
    );

  useEffect(() => {
    if (!active) return;

    // New run: clear the old map and pick fresh hotspots.
    setPoints([]);
    hotspotsRef.current = Array.from({ length: HOTSPOTS }, randomHotspot);

    const id = setInterval(() => {
      // Drift the hotspots a little so density evolves over the session.
      hotspotsRef.current = hotspotsRef.current.map((h) => ({
        x: clamp01(h.x + (Math.random() - 0.5) * HOTSPOT_DRIFT),
        y: clamp01(h.y + (Math.random() - 0.5) * HOTSPOT_DRIFT),
      }));

      const batch: Point[] = [];
      for (let i = 0; i < CLICKS_PER_TICK; i++) {
        if (Math.random() < NOISE_FRACTION) {
          batch.push({ x: Math.random(), y: Math.random() });
        } else {
          const h = hotspotsRef.current[Math.floor(Math.random() * hotspotsRef.current.length)];
          batch.push({
            x: clamp01(h.x + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
            y: clamp01(h.y + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
          });
        }
      }
      setPoints((prev) =>
        prev.length >= MAX_POINTS ? prev : [...prev, ...batch].slice(0, MAX_POINTS),
      );
    }, TICK_MS);

    return () => clearInterval(id);
  }, [active]);

  return { points, addClick };
}
```

- [ ] **Step 2: Verify types**

Run (in `client/`): `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/kick/useClickHeatmap.ts
git commit -m "feat(heatmap): mock-click data hook with drifting hotspots"
```

---

### Task 3: `Heatmap` canvas renderer

A pure canvas component that paints the points as a translucent density heatmap. No React state per point; drawing is a side effect of the `points` prop and element size.

**Files:**
- Create: `client/src/kick/Heatmap.tsx`

**Interfaces:**
- Consumes: `Point` from `./useClickHeatmap` (Task 2).
- Produces: `export default function Heatmap({ points, className }: { points: Point[]; className?: string })`.

- [ ] **Step 1: Write the component**

Create `client/src/kick/Heatmap.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { Point } from './useClickHeatmap';

/** Radius of a single click's influence, in CSS pixels. */
const BLOB_RADIUS = 26;
/** Per-blob peak opacity in the alpha pass; overlapping blobs sum toward full. */
const BLOB_ALPHA = 0.28;

/** 256-entry blue→cyan→green→yellow→red lookup, indexed by accumulated alpha.
 *  Built once from a canvas gradient. Returns a flat RGBA array (length 1024). */
function buildGradient(): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#0000ff');
  grad.addColorStop(0.4, '#00ffff');
  grad.addColorStop(0.6, '#00ff00');
  grad.addColorStop(0.8, '#ffff00');
  grad.addColorStop(1.0, '#ff0000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 256);
  return g.getImageData(0, 0, 1, 256).data;
}

/**
 * Translucent click-density heatmap drawn on a canvas that fills its parent.
 *
 * Two passes, the standard heatmap technique:
 *   1. draw every point as a soft radial blob into an alpha buffer, so
 *      overlapping clicks accumulate coverage;
 *   2. recolor each pixel by its accumulated alpha through a warm gradient LUT,
 *      keeping a scaled alpha so the map reads as a translucent overlay.
 *
 * Points are normalized [0,1]; a ResizeObserver keeps the canvas backing store
 * matched to its displayed size (device-pixel-ratio aware) and repaints.
 */
export default function Heatmap({ points, className }: { points: Point[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gradientRef = useRef<Uint8ClampedArray | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!gradientRef.current) gradientRef.current = buildGradient();
    const gradient = gradientRef.current;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.clearRect(0, 0, w, h);
      if (points.length === 0) return;

      // Pass 1: alpha blobs.
      ctx.globalCompositeOperation = 'source-over';
      const r = BLOB_RADIUS * dpr;
      for (const p of points) {
        const x = p.x * w;
        const y = p.y * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${BLOB_ALPHA})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pass 2: colorize by alpha.
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        const off = a * 4; // LUT index by 0..255 alpha
        d[i] = gradient[off];
        d[i + 1] = gradient[off + 1];
        d[i + 2] = gradient[off + 2];
        // Cap overlay opacity so the video stays visible underneath.
        d[i + 3] = Math.min(200, a);
      }
      ctx.putImageData(img, 0, 0);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points]);

  return <canvas ref={canvasRef} className={className} />;
}
```

- [ ] **Step 2: Verify types**

Run (in `client/`): `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/kick/Heatmap.tsx
git commit -m "feat(heatmap): dependency-free canvas density renderer"
```

---

### Task 4: Wire heatmap into `StreamPreview`

Add the `🔥` toggle, drive the hook off `gymOn`, overlay the heatmap when live and enabled, and let a real click on the preview add a point. This is the task that makes the feature visible end-to-end.

**Files:**
- Modify: `client/src/kick/StreamPreview.tsx` (whole file)

**Interfaces:**
- Consumes: `useClickHeatmap` (Task 2), `Heatmap` (Task 3), `PanelButton` with `onClick`/`active` (Task 1).
- Produces: unchanged public signature `StreamPreview({ gymOn }: { gymOn: boolean })`.

- [ ] **Step 1: Rewrite `StreamPreview.tsx`**

Replace the whole file with:

```tsx
import { useState } from 'react';
import { ExternalLink, Flame, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import Heatmap from './Heatmap';
import { useClickHeatmap } from './useClickHeatmap';

/** Kick's "Stream Preview" panel. No real stream, so the body is filled by the
 *  offline banner normally, swapped for a looping gym video while the gym is
 *  running. While live, a 🔥 toggle overlays a click-density heatmap (mock
 *  clicks, plus any real click on the preview) on top of the video. */
export default function StreamPreview({ gymOn }: { gymOn: boolean }) {
  const [heatmapOn, setHeatmapOn] = useState(false);
  const { points, addClick } = useClickHeatmap(gymOn);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!gymOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    addClick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  return (
    <Panel
      title="Stream Preview"
      icon={<MonitorPlay size={16} />}
      className="h-full"
      bodyClassName="relative overflow-hidden bg-black"
      actions={
        <>
          {gymOn && (
            <PanelButton
              label={heatmapOn ? 'Hide click heatmap' : 'Show click heatmap'}
              active={heatmapOn}
              onClick={() => setHeatmapOn((on) => !on)}
            >
              <Flame size={16} />
            </PanelButton>
          )}
          <PanelButton label="Popout Stream Preview">
            <ExternalLink size={16} />
          </PanelButton>
        </>
      }
    >
      {/* Absolute fill: the body is the panel minus its header, so it is never
          exactly 16:9 and a normal-flow element would overflow across the header. */}
      <div className="absolute inset-0" onClick={handleClick}>
        {gymOn ? (
          <video
            src="/video-placeholder.mp4"
            autoPlay
            loop
            muted
            playsInline
            poster="/gym.png"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <img
            src="/offline-banner.webp"
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {gymOn && heatmapOn && (
          <Heatmap points={points} className="pointer-events-none absolute inset-0 size-full" />
        )}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Verify types**

Run (in `client/`): `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 3: Manual end-to-end check**

Run (repo root): `pnpm dev:simulator`, open http://localhost:5173, pick **Training**, hit **Start**.
Verify:
- Video loops in Stream Preview; a `🔥` button appears in the panel header.
- Click `🔥` → button turns green, heatmap appears and **density visibly accumulates into warm hotspots over ~20–30s**.
- Click on the preview → a point lands under the cursor.
- Resize the window → heatmap stays aligned to the video (no drift).
- Stop, then Start again → heatmap clears and rebuilds from empty.
- Click `🔥` off → overlay disappears, video unaffected. `🔥` disappears entirely when the stream is stopped.

- [ ] **Step 4: Commit**

```bash
git add client/src/kick/StreamPreview.tsx
git commit -m "feat(stream-preview): toggleable click-density heatmap overlay"
```

---

## Self-Review

**Spec coverage:**
- Accumulating behavior → Task 2 (`MAX_POINTS` cap, no fade, reset on `active` false→true). ✓
- Toggle button (`🔥`) → Task 1 (button props) + Task 4 (toggle + render gating). ✓
- Mock clicks, clustered → Task 2 (drifting hotspots + noise). ✓
- Real click adds a point → Task 4 (`handleClick` → `addClick`). ✓
- Hand-rolled canvas, two-pass, DPR-aware, ResizeObserver → Task 3. ✓
- Normalized coords survive resize → Tasks 2/3/4. ✓
- Effect cleanup (StrictMode) → Task 2 (`clearInterval`), Task 3 (`ro.disconnect`). ✓
- No backend / SSE / bandit changes → confirmed; only `client/src/kick/` touched. ✓
- No new deps → confirmed; uses `lucide-react`'s `Flame` icon, already available. ✓

**Placeholder scan:** No TBD/TODO; every code step has full content. ✓

**Type consistency:** `Point` defined in Task 2, imported by Tasks 3 & 4. `useClickHeatmap(active) → { points, addClick }` matches usage in Task 4. `Heatmap({ points, className })` matches Task 4's call. `PanelButton`'s new optional `onClick`/`active` match Task 4's usage. ✓
