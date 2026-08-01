import { useEffect, useRef } from 'react';
import { FADE_MS, type Point } from './useClickHeatmap';

/** Radius of a single click's influence, in CSS pixels. */
const BLOB_RADIUS = 34;
/** Per-blob peak opacity in the alpha pass; overlapping blobs sum toward full.
 *  Kept high so even scattered single clicks are visible and dense clusters run
 *  hot (red) quickly. */
const BLOB_ALPHA = 0.6;
/** Ceiling on the colorized overlay's per-pixel opacity (0–255). High enough to
 *  read clearly over the video while still letting it show through. */
const MAX_OVERLAY_ALPHA = 235;

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

/** Cap the redraw rate. Each frame reads back the whole canvas (getImageData),
 *  so 60fps is wasteful; ~30fps is smooth enough for a fade. */
const FRAME_MS = 1000 / 30;

/**
 * Translucent click-density heatmap drawn on a canvas that fills its parent.
 *
 * Two passes, the standard heatmap technique:
 *   1. draw every point as a soft radial blob into an alpha buffer, so
 *      overlapping clicks accumulate coverage — each blob scaled by how much
 *      life it has left, so a click fades out over FADE_MS;
 *   2. recolor each pixel by its accumulated alpha through a warm gradient LUT,
 *      keeping a scaled alpha so the map reads as a translucent overlay.
 *
 * Because points fade continuously (not only when new ones arrive), the canvas
 * repaints on a throttled requestAnimationFrame loop rather than on prop change.
 * Points are normalized [0,1]; a ResizeObserver keeps the canvas backing store
 * matched to its displayed size (device-pixel-ratio aware).
 */
export default function Heatmap({ points, className }: { points: Point[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gradientRef = useRef<Uint8ClampedArray | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // Mount once: build the gradient LUT, wire up the draw function (reading the
  // latest points via a ref so it never goes stale), and observe resizes.
  // Kept to `[]` deps so the ResizeObserver isn't torn down/recreated on every
  // points update (~every 350ms).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    if (!gradientRef.current) gradientRef.current = buildGradient();
    const gradient = gradientRef.current;

    const draw = () => {
      const points = pointsRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.clearRect(0, 0, w, h);
      if (points.length === 0) return;

      // Pass 1: alpha blobs, each dimmed by how much life it has left so it
      // fades out over FADE_MS.
      const now = Date.now();
      ctx.globalCompositeOperation = 'source-over';
      const r = BLOB_RADIUS * dpr;
      for (const p of points) {
        const life = 1 - (now - p.born) / FADE_MS;
        if (life <= 0) continue;
        const x = p.x * w;
        const y = p.y * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${BLOB_ALPHA * life})`);
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
        d[i + 3] = Math.min(MAX_OVERLAY_ALPHA, a);
      }
      ctx.putImageData(img, 0, 0);
    };

    const ro = new ResizeObserver(draw);
    ro.observe(canvas);

    // Points fade continuously, so repaint on a throttled rAF loop rather than
    // only when the points prop changes.
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      draw();
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} />;
}
