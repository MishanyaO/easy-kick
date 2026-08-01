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
