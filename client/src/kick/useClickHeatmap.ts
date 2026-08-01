import { useCallback, useRef, useState } from 'react';
import type { ClickPoint } from '../types';

export type Point = ClickPoint;

/** Hard cap on the streamer's own clicks. They are a garnish on a stream of thousands —
 *  this only stops a held-down mouse from growing the array without bound. */
const MAX_LOCAL = 200;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The points the Stream Preview heatmap draws.
 *
 * The audience's taps are not invented here: they arrive over SSE from the running
 * scenario, which models them the same way it models chat — off the same clock, off the
 * same beats, and surging when the bot fires a click rally. This hook only merges in the
 * streamer's own clicks on the preview, so a click on the video contributes a point like
 * anyone else's.
 *
 * `serverPoints` is already bounded and ordered oldest-first by `useGambit`; local clicks
 * are appended after it, which is where the renderer's newest-is-hottest ordering wants
 * them.
 */
export function useClickHeatmap(serverPoints: Point[]): {
  points: Point[];
  addClick: (nx: number, ny: number) => void;
} {
  const [local, setLocal] = useState<Point[]>([]);
  // Merge lazily and cache: the server stream re-renders this component many times a
  // second, and rebuilding a 600-point array on every one of them is the whole cost.
  const merged = useRef<{ server: Point[]; local: Point[]; points: Point[] }>({
    server: [], local: [], points: [],
  });

  const addClick = useCallback((nx: number, ny: number) => {
    setLocal((prev) => {
      const next = [...prev, { x: clamp01(nx), y: clamp01(ny), born: Date.now() }];
      return next.length > MAX_LOCAL ? next.slice(next.length - MAX_LOCAL) : next;
    });
  }, []);

  if (merged.current.server !== serverPoints || merged.current.local !== local) {
    merged.current = { server: serverPoints, local, points: [...serverPoints, ...local] };
  }

  return { points: merged.current.points, addClick };
}
