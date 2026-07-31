// One graph for viewers, active viewers and actions, with the intervention ledger overlaid
// as vertical markers on the same timeline.
//
// Two things a growing session breaks, and how this handles them:
//
// Fitting an hours-long run into a fixed width squeezes it until nothing is legible, so the
// chart is drawn at a constant width per sample inside an ordinary horizontally scrolling
// box. Real scrolling, not a gesture we invented: the trackpad, the scrollbar, shift-wheel
// and the keyboard all work because none of them are ours. Under it sits a minimap of the
// whole session showing where the actions are — the part a scrollbar cannot tell you —
// which frames the visible slice and jumps the view when clicked.
//
// And hovering a marker used to open a tooltip on top of the chart, covering the very thing
// it described. The readout is a reserved line under the axis now: it changes as you sweep
// across the markers and never occludes anything.
import { useEffect, useRef, useState } from 'react';
import {
  ARM_LABEL, VERDICT_COLOR, clock as fmt, labelFor, peopleShort, points,
  type ActionFrame, type ResultFrame,
} from '../types';

export type GraphSeries = { data: number[]; color: string; label: string; scaleGroup?: string };
export type Intervention = { index: number; result: ResultFrame & { action?: ActionFrame } };

/** The chart's own coordinate space. It is stretched to the scrolling content width, so
 *  this is a resolution, not a size. */
const W = 640;
/** On-screen width per sample. The whole point of the scroller: density stays constant as
 *  the session grows, instead of the session being compressed into the panel. */
const PX_PER_SAMPLE = 7;
const MAP_H = 22;
/** How far the minimap's drag handles can zoom in — narrower than this and there's nothing
 *  left to read off the chart. */
const MAX_ZOOM = 30;
/** One time label per this many pixels of chart. */
const PX_PER_TICK = 130;
/** The measurement window every decision opens, in virtual seconds. */
const WINDOW_S = 60;

// candidate spacings, in virtual seconds — round steps a viewer would actually read off a clock
const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Round-time tick marks (:00, :05, :10, ...) whose spacing widens as the visible span
 *  grows, so 3 minutes on screen gets per-30s ticks and 3 hours gets per-30min ticks. */
function timeTicks(from: number, to: number, target: number): number[] {
  const span = to - from;
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}

/** Nearest history index to a given elapsed time — elapsed values are monotonic, so a
 *  linear scan is enough; no need for a real binary search. */
function nearestIndex(elapsed: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < elapsed.length; i++) {
    if (Math.abs(elapsed[i] - target) < Math.abs(elapsed[best] - target)) best = i;
  }
  return best;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** An SVG path through the whole of `data`, scaled to `max` within a box of height `h`. */
function line(data: number[], max: number, h: number, pad: number, x: (i: number) => number) {
  const y = (v: number) => h - (v / max) * (h - pad) - pad / 2;
  let d = '';
  for (let i = 0; i < data.length; i++) {
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(data[i]).toFixed(1)}`;
  }
  return d;
}

export default function InsightsGraph({
  series, interventions, elapsedS, viewers, height = 96,
}: {
  series: GraphSeries[];
  interventions: Intervention[];
  elapsedS?: number[];
  /** Audience size per sample, only so the readout can say a lift in people rather than
   *  points. Optional: without it that figure is simply dropped. */
  viewers?: number[];
  height?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  /** Following the live edge. True until the streamer scrolls back, and true again the
   *  moment they scroll to the end — the same rule a chat window uses. */
  const [live, setLive] = useState(true);
  /** The visible slice as fractions of the scroll width, for the minimap's frame. */
  const [view, setView] = useState({ start: 0, size: 1 });
  const [dragMode, setDragMode] = useState<'pan' | 'left' | 'right' | null>(null);
  /** How much denser than the base density the chart is drawn at. 1 until a minimap
   *  handle is dragged; the only way to zoom in, since scrolling alone can't. */
  const [zoom, setZoom] = useState(1);
  /** The band edge not being dragged, captured when a resize starts — the fixed end a
   *  resize pivots around. */
  const dragAnchorRef = useRef<number | null>(null);
  /** A scrollLeft to apply once the zoom that made it valid has actually painted. */
  const pendingScrollLeftRef = useRef<number | null>(null);

  const len = Math.max(0, ...series.map((s) => s.data.length));
  const contentPx = Math.round(len * PX_PER_SAMPLE * zoom);

  // A resize handle just changed `zoom`; the scrollWidth it implies only exists after
  // this render commits, so the scrollLeft it was computed for is applied here.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScrollLeftRef.current == null) return;
    el.scrollLeft = pendingScrollLeftRef.current;
    pendingScrollLeftRef.current = null;
    setLive(el.scrollWidth - el.clientWidth - el.scrollLeft < 4);
    setView({
      start: el.scrollLeft / Math.max(1, el.scrollWidth),
      size: el.clientWidth / Math.max(1, el.scrollWidth),
    });
  }, [zoom]);

  // Keep the newest sample on screen while following, and keep the minimap's frame honest
  // about where the scroller actually is.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (live) el.scrollLeft = el.scrollWidth;
    const size = el.clientWidth / Math.max(1, el.scrollWidth);
    const start = el.scrollLeft / Math.max(1, el.scrollWidth);
    setView((v) => (Math.abs(v.start - start) < 0.002 && Math.abs(v.size - size) < 0.002
      ? v : { start, size }));
  }, [len, live, contentPx]);

  if (len < 2) return <div style={{ height }} />;

  const x = (i: number) => (i / (len - 1)) * W;
  const groupMax = (group: string) => (Math.max(
    1, ...series.filter((s) => s.scaleGroup === group).flatMap((s) => s.data),
  ) * 1.15);

  const shown = interventions.find((iv) => iv.index === hover)?.result ?? null;

  /** Where the hovered window opened: 60 virtual seconds before it closed, in samples.
   *  Null when nothing is hovered, or there is no clock to measure that against. */
  const band = shown !== null && hover !== null && elapsedS?.length
    ? (() => {
      const from = nearestIndex(elapsedS, elapsedS[hover] - WINDOW_S);
      return from < hover ? from : null;
    })()
    : null;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setLive(el.scrollWidth - el.clientWidth - el.scrollLeft < 4);
    setView({
      start: el.scrollLeft / Math.max(1, el.scrollWidth),
      size: el.clientWidth / Math.max(1, el.scrollWidth),
    });
  };

  const toLive = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    setLive(true);
  };

  /** Snap the hover to the nearest marker under the pointer — the dashed lines are 1px and
   *  chasing one with a mouse is a game, not a reading. */
  const hoverAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !interventions.length) return setHover(null);
    const at = clamp((clientX - rect.left) / rect.width, 0, 1) * (len - 1);
    const near = interventions.reduce((best, iv) =>
      Math.abs(iv.index - at) < Math.abs(best.index - at) ? iv : best);
    // A fixed pixel tolerance, converted to samples — the same feel at any zoom.
    setHover(Math.abs(near.index - at) <= 8 / PX_PER_SAMPLE ? near.index : null);
  };

  /** Centre the scroller on a point in the minimap. */
  const jumpTo = (clientX: number) => {
    const el = scrollRef.current;
    const rect = mapRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    el.scrollLeft = frac * el.scrollWidth - el.clientWidth / 2;
  };

  /** Drag a minimap band edge to narrow (zoom in) or widen (zoom out) the visible slice,
   *  pivoting on the edge not being dragged. Re-derives zoom from the requested band width,
   *  since that width is what the user is actually asking for. */
  const resizeEdge = (edge: 'left' | 'right', clientX: number) => {
    const el = scrollRef.current;
    const rect = mapRef.current?.getBoundingClientRect();
    const anchor = dragAnchorRef.current;
    if (!el || !rect || anchor == null) return;
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    const minSize = el.clientWidth / (len * PX_PER_SAMPLE * MAX_ZOOM);
    let s = edge === 'left' ? frac : anchor;
    let e = edge === 'left' ? anchor : frac;
    if (e - s < minSize) { if (edge === 'left') s = e - minSize; else e = s + minSize; }
    s = clamp(s, 0, 1 - minSize);
    e = clamp(e, minSize, 1);

    const newZoom = clamp(el.clientWidth / (len * PX_PER_SAMPLE * (e - s)), 1, MAX_ZOOM);
    pendingScrollLeftRef.current = s * len * PX_PER_SAMPLE * newZoom;
    setLive(false);
    setZoom(newZoom);
  };

  const ticks = elapsedS && elapsedS.length >= 2
    ? timeTicks(elapsedS[0], elapsedS[elapsedS.length - 1],
      Math.max(2, Math.round(contentPx / PX_PER_TICK)))
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="size-1.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <button onClick={toLive} disabled={live}
          className="ml-auto flex items-center gap-1 text-[10px] font-semibold transition-colors"
          style={{ color: live ? 'var(--text-muted)' : 'var(--kick-green)' }}>
          <span className="size-1.5 rounded-full"
            style={{ background: live ? 'var(--kick-green)' : 'var(--text-muted)' }} />
          {live ? 'live' : 'jump to live'}
        </button>
      </div>

      {/* `overscroll-x: contain` so a hard trackpad swipe scrolls the chart instead of
          triggering the browser's back gesture. */}
      <div ref={scrollRef} onScroll={onScroll}
        className="mt-1.5 overflow-x-auto overflow-y-hidden"
        style={{ overscrollBehaviorX: 'contain' }}>
        <div style={{ width: contentPx, minWidth: '100%' }}>
          {/* Pins, above the plot rather than on it. A dashed hairline is easy to miss and
              impossible to aim at; a coloured pin says an action happened here and how it
              went before anyone hovers anything. They live in HTML, not the SVG, because
              the plot is stretched horizontally and would stretch a shape with it. */}
          <div className="relative h-2.5">
            {interventions.map(({ index, result: r }) => {
              const on = hover === index;
              return (
                <span key={r.action_id}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  className="absolute bottom-0 block -translate-x-1/2 cursor-pointer rounded-[1px] transition-[width,height,opacity]"
                  style={{
                    left: `${(index / (len - 1)) * 100}%`,
                    width: on ? 9 : 5,
                    height: on ? 9 : 5,
                    background: VERDICT_COLOR[labelFor(r)],
                    opacity: on ? 1 : 0.8,
                  }} />
              );
            })}
          </div>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', height }}
            onMouseMove={(e) => hoverAt(e.clientX)}
            onMouseLeave={() => setHover(null)}
          >
            {series.map(({ data, color, scaleGroup }, i) => {
              const max = scaleGroup ? groupMax(scaleGroup) : (Math.max(...data) * 1.15 || 1);
              return (
                <path key={i} d={line(data, max, height, 6, x)} fill="none" stroke={color}
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              );
            })}
            {/* The measured stretch, shaded on hover — the 60s the verdict was read off,
                shown where it happened instead of described somewhere else. */}
            {band !== null && shown && (
              <rect x={x(band)} width={Math.max(1, x(hover as number) - x(band))}
                y={0} height={height} fill={VERDICT_COLOR[labelFor(shown)]} opacity={0.14} />
            )}
            {interventions.map(({ index, result: r }) => (
              <line key={r.action_id} x1={x(index)} x2={x(index)} y1={0} y2={height}
                stroke={VERDICT_COLOR[labelFor(r)]} strokeWidth={hover === index ? 2 : 1}
                strokeDasharray={hover === index ? undefined : '2,2'}
                opacity={hover === index ? 1 : 0.5}
                vectorEffect="non-scaling-stroke" />
            ))}
          </svg>

          {elapsedS && elapsedS.length >= 2 && (
            <div className="relative mt-1 h-3 text-[9px] text-[var(--text-muted)]">
              {ticks.map((t) => (
                <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${(nearestIndex(elapsedS, t) / (len - 1)) * 100}%` }}>
                  {fmt(t)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The readout. A reserved line, not a popup: it holds its height whether or not
          anything is hovered, so the chart above never moves and never gets covered. It
          fills with the verdict's colour when a marker is live under the pointer — a bare
          line of small grey text 30px away is easy to miss while looking at the chart. */}
      <div className="mt-1 flex h-[22px] items-center gap-2 overflow-hidden rounded-sm px-2 text-[11px] transition-colors"
        style={{
          background: shown ? 'var(--bg-elevated)' : 'transparent',
          borderLeft: `2px solid ${shown ? VERDICT_COLOR[labelFor(shown)] : 'transparent'}`,
        }}>
        {shown ? (
          <>
            <span className="shrink-0 font-semibold" style={{ color: VERDICT_COLOR[labelFor(shown)] }}>
              {labelFor(shown)} · {ARM_LABEL[shown.arm]}
            </span>
            {shown.action?.body && (
              <span className="min-w-0 truncate text-[var(--text-secondary)]">
                “{shown.action.body}”
              </span>
            )}
            <span className="tnum ml-auto shrink-0 text-[13px] font-bold"
              style={{ color: VERDICT_COLOR[labelFor(shown)] }}>
              {points(shown.engagement_delta)}
            </span>
            {!shown.contaminated && hover !== null && (
              <span className="tnum shrink-0 text-[10px] text-[var(--text-muted)]">
                {peopleShort(shown.engagement_delta, viewers?.[hover])}
              </span>
            )}
            {hover !== null && elapsedS?.[hover] != null && (
              <span className="tnum shrink-0 text-[10px] text-[var(--text-muted)]">
                {fmt(elapsedS[hover])}
              </span>
            )}
          </>
        ) : (
          <span className="truncate text-[10px] text-[var(--text-muted)]">
            {interventions.length
              ? `${interventions.length} actions on this timeline — hover a pin to read one`
              : 'markers appear here as windows close'}
          </span>
        )}
      </div>

      {/* The minimap: the whole session at a glance, and the one thing the scrollbar cannot
          show you — where in it anything actually happened. Always on, not just once the
          session outgrows the panel, so it doesn't pop in mid-stream. Its band's edges
          double as zoom handles — drag one in to zoom to that stretch, drag it back out
          to zoom out. */}
      <svg ref={mapRef} viewBox={`0 0 ${W} ${MAP_H}`} preserveAspectRatio="none"
        className="mt-1 cursor-pointer"
        style={{ display: 'block', width: '100%', height: MAP_H }}
        onMouseDown={(e) => { setDragMode('pan'); jumpTo(e.clientX); }}
        onMouseMove={(e) => {
          if (dragMode === 'pan') jumpTo(e.clientX);
          else if (dragMode === 'left') resizeEdge('left', e.clientX);
          else if (dragMode === 'right') resizeEdge('right', e.clientX);
        }}
        onMouseUp={() => setDragMode(null)}
        onMouseLeave={() => setDragMode(null)}
      >
        <rect x={0} y={0} width={W} height={MAP_H} fill="var(--bg-elevated)" />
        {series.map(({ data, color }, i) => (
          <path key={i} d={line(data, Math.max(...data) * 1.15 || 1, MAP_H, 4, x)}
            fill="none" stroke={color} strokeWidth="1" opacity={0.35}
            vectorEffect="non-scaling-stroke" />
        ))}
        {interventions.map(({ index, result: r }) => (
          <line key={r.action_id} x1={x(index)} x2={x(index)} y1={0} y2={MAP_H}
            stroke={VERDICT_COLOR[labelFor(r)]} strokeWidth="1" opacity={0.55}
            vectorEffect="non-scaling-stroke" />
        ))}
        <rect x={view.start * W} width={Math.max(2, view.size * W)} y={0} height={MAP_H}
          fill="var(--text-primary)" fillOpacity={0.1}
          stroke="var(--kick-green)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <rect x={view.start * W - 4} y={0} width={8} height={MAP_H} fill="transparent"
          style={{ cursor: 'ew-resize' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            dragAnchorRef.current = view.start + view.size;
            setDragMode('left');
          }} />
        <rect x={(view.start + view.size) * W - 4} y={0} width={8} height={MAP_H} fill="transparent"
          style={{ cursor: 'ew-resize' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            dragAnchorRef.current = view.start;
            setDragMode('right');
          }} />
      </svg>
    </div>
  );
}
