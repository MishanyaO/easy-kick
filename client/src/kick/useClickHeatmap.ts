import { useEffect, useRef, useState } from 'react';

/** A click in normalized [0,1] coordinates (so points stay correct across
 *  resizes of the preview) plus the wall-clock time it landed, in ms — the
 *  renderer fades a blob out over its age. */
export type Point = { x: number; y: number; born: number };

/** How long a click takes to fade from full intensity to gone, in ms. The
 *  renderer scales each blob by its remaining life; here we drop points once
 *  they're fully faded so the array stays small. Tunable. */
export const FADE_MS = 4500;

/** Hard safety cap on live points. With the fade above and the mock click rate
 *  the steady state is a few dozen, so this is only a runaway guard. */
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

type Center = { x: number; y: number };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A random hotspot center kept away from the very edges. */
function randomHotspot(): Center {
  return { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 };
}

/**
 * Owns the click-density data for the Stream Preview heatmap.
 *
 * While `active`, a timer emits mock clicks: most cluster around a handful of
 * slowly drifting hotspots, the rest are scattered noise, so the map reads like
 * where an audience is looking rather than uniform static. Each click carries a
 * birth time and fades out over `FADE_MS`; fully faded points are pruned here so
 * the map breathes and shifts instead of accumulating forever. The map resets
 * whenever `active` goes false→true — i.e. a fresh stream run starts. `addClick`
 * lets a real click on the preview contribute a point too.
 */
export function useClickHeatmap(active: boolean): {
  points: Point[];
  addClick: (nx: number, ny: number) => void;
} {
  const [points, setPoints] = useState<Point[]>([]);
  const hotspotsRef = useRef<Center[]>([]);

  const addClick = (nx: number, ny: number) =>
    setPoints((prev) =>
      prev.length >= MAX_POINTS
        ? prev
        : [...prev, { x: clamp01(nx), y: clamp01(ny), born: Date.now() }],
    );

  useEffect(() => {
    if (!active) {
      // Stream isn't live: clear the map so a restart never flashes stale points.
      setPoints([]);
      return;
    }

    // New run: clear the old map and pick fresh hotspots.
    setPoints([]);
    hotspotsRef.current = Array.from({ length: HOTSPOTS }, randomHotspot);

    const id = setInterval(() => {
      const now = Date.now();

      // Drift the hotspots a little so density evolves over the session.
      hotspotsRef.current = hotspotsRef.current.map((h) => ({
        x: clamp01(h.x + (Math.random() - 0.5) * HOTSPOT_DRIFT),
        y: clamp01(h.y + (Math.random() - 0.5) * HOTSPOT_DRIFT),
      }));

      const batch: Point[] = [];
      for (let i = 0; i < CLICKS_PER_TICK; i++) {
        if (Math.random() < NOISE_FRACTION) {
          batch.push({ x: Math.random(), y: Math.random(), born: now });
        } else {
          const h = hotspotsRef.current[Math.floor(Math.random() * hotspotsRef.current.length)];
          batch.push({
            x: clamp01(h.x + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
            y: clamp01(h.y + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
            born: now,
          });
        }
      }

      // Drop fully faded points, then append this tick's batch.
      setPoints((prev) =>
        [...prev.filter((p) => now - p.born < FADE_MS), ...batch].slice(0, MAX_POINTS),
      );
    }, TICK_MS);

    return () => clearInterval(id);
  }, [active]);

  return { points, addClick };
}
