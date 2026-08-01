import { useEffect, useState } from 'react';

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
const CLICKS_PER_TICK = 4;
const TICK_MS = 350;

/** The hot spot the mock audience keeps clicking — 20% across, 30% down. Most
 *  clicks land here so it builds into an obvious warm core. */
const PRIMARY = { x: 0.2, y: 0.3 };
/** Fraction of mock clicks that land near PRIMARY; the rest are scattered
 *  random clicks across the frame. */
const PRIMARY_FRACTION = 0.7;
/** Spread of a clustered click around PRIMARY (std-dev-ish, normalized units). */
const CLUSTER_SPREAD = 0.05;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Owns the click-density data for the Stream Preview heatmap.
 *
 * While `active`, a timer emits mock clicks: most cluster tightly around a fixed
 * hot spot (`PRIMARY`), the rest are scattered random clicks, so a clear warm
 * core forms where the audience keeps clicking. Each click carries a birth time
 * and fades out over `FADE_MS`; fully faded points are pruned here so the map
 * breathes instead of accumulating forever. The map resets whenever `active`
 * goes false→true — i.e. a fresh stream run starts. `addClick` lets a real click
 * on the preview contribute a point too.
 */
export function useClickHeatmap(active: boolean): {
  points: Point[];
  addClick: (nx: number, ny: number) => void;
} {
  const [points, setPoints] = useState<Point[]>([]);

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

    // New run: clear the old map.
    setPoints([]);

    const id = setInterval(() => {
      const now = Date.now();

      const batch: Point[] = [];
      for (let i = 0; i < CLICKS_PER_TICK; i++) {
        if (Math.random() < PRIMARY_FRACTION) {
          batch.push({
            x: clamp01(PRIMARY.x + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
            y: clamp01(PRIMARY.y + (Math.random() - 0.5) * 2 * CLUSTER_SPREAD),
            born: now,
          });
        } else {
          batch.push({ x: Math.random(), y: Math.random(), born: now });
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
