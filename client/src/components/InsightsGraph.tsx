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
// And reading a marker has to happen where the marker is. A tooltip on top of the chart
// covers the very thing it describes; a readout line under the axis is 40px from where you
// are looking, which on a projector may as well be another screen. So the card is anchored
// to the pin and opens into a reserved band *above* the plot: next to what you hovered,
// over nothing, and the chart never moves because the band is always there.
import { useEffect, useRef, useState } from 'react';
import {
  ARM_LABEL, VERDICT_COLOR, clock as fmt, labelFor, peopleShort, points,
  type ActionFrame, type ResultFrame,
} from '../types';

export type GraphSeries = {
  data: number[];
  color: string;
  label: string;
  scaleGroup?: string;
  /** Context rather than subject: drawn thin and faint so it reads as a backdrop the
   *  other lines move against. */
  dim?: boolean;
};
export type Intervention = { index: number; result: ResultFrame & { action?: ActionFrame } };

/** The chart's own coordinate space. It is stretched to the scrolling content width, so
 *  this is a resolution, not a size. */
const W = 640;
/** On-screen width per sample. The whole point of the scroller: density stays constant as
 *  the session grows, instead of the session being compressed into the panel. */
const PX_PER_SAMPLE = 7;
const MAP_H = 22;
/**
 * The band the hover card opens into.
 *
 * Reserved whether or not anything is hovered, because a chart that jumps when the pointer
 * crosses a pin is unreadable. It must clear the TALLER of the two cards: the scroller
 * around it is `overflow-y: hidden` (it has to be — `overflow-x: auto` forces it), so a
 * card even a pixel taller than this is silently cropped along its top edge rather than
 * overflowing. Measured, not guessed; if a row is ever added to either card, re-measure.
 */
const POP_H = 84;
const POP_W = 380;
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

/** A series value as a person would say it. Counts are whole; rates are not. */
const readout = (v: number | undefined) =>
  v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1);

/** Width of a `00:00:00` label, in a unit that tracks the font. */
const LABEL_CH = '8ch';

const centred = (at: string, w: string) =>
  `clamp(0px, calc(${at} - ${w} / 2), calc(100% - ${w}))`;

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
  series, interventions, elapsedS, viewers, onSelect, height = 112,
}: {
  series: GraphSeries[];
  interventions: Intervention[];
  elapsedS?: number[];
  /** Audience size per sample, only so the readout can say a lift in people rather than
   *  points. Optional: without it that figure is simply dropped. */
  viewers?: number[];
  /** Clicking a pin hands the window back to whoever owns the ledger, which is the only
   *  thing that can open it. Without this the pins are read-only. */
  onSelect?: (r: ResultFrame) => void;
  height?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<SVGSVGElement>(null);
  /** The pin under the pointer, snapped. Null when the pointer is between pins. */
  const [hover, setHover] = useState<number | null>(null);
  /** The sample under the pointer, snapped to nothing. Between pins this is what the
   *  readout speaks for — "what were the numbers here" is the question a line chart raises
   *  everywhere along its length, not only where something happened. */
  const [at, setAt] = useState<number | null>(null);
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
  /** The chart's width at zoom 1 — the unit both the minimap fractions and the zoom maths
   *  are expressed in. */
  const basePx = len * PX_PER_SAMPLE;
  const contentPx = Math.round(basePx * zoom);

  /** Re-read where the scroller actually is, for the minimap's frame and the follow flag. */
  const syncView = (el: HTMLDivElement) => {
    setLive(el.scrollWidth - el.clientWidth - el.scrollLeft < 4);
    setView({
      start: el.scrollLeft / Math.max(1, el.scrollWidth),
      size: el.clientWidth / Math.max(1, el.scrollWidth),
    });
  };

  // A resize handle just changed `zoom`; the scrollWidth it implies only exists after
  // this render commits, so the scrollLeft it was computed for is applied here.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScrollLeftRef.current == null) return;
    el.scrollLeft = pendingScrollLeftRef.current;
    pendingScrollLeftRef.current = null;
    syncView(el);
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
  /** Where the card and the crosshair sit: on the snapped pin when there is one, otherwise
   *  wherever the pointer is. */
  const cursor = hover ?? at;

  /** Where the hovered window opened: 60 virtual seconds before it closed, in samples.
   *  Null when nothing is hovered, or there is no clock to measure that against. */
  const band = shown !== null && hover !== null && elapsedS?.length
    ? (() => {
      const from = nearestIndex(elapsedS, elapsedS[hover] - WINDOW_S);
      return from < hover ? from : null;
    })()
    : null;

  const onScroll = () => {
    if (scrollRef.current) syncView(scrollRef.current);
  };

  const toLive = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    setLive(true);
  };

  /** Track the sample under the pointer, and snap to a marker when one is close enough —
   *  the dashed lines are 1px and chasing one with a mouse is a game, not a reading. */
  const hoverAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = clamp((clientX - rect.left) / rect.width, 0, 1) * (len - 1);
    setAt(Math.round(raw));
    if (!interventions.length) return setHover(null);
    const near = interventions.reduce((best, iv) =>
      Math.abs(iv.index - raw) < Math.abs(best.index - raw) ? iv : best);
    // A fixed pixel tolerance, converted to samples — the same feel at any zoom.
    setHover(Math.abs(near.index - raw) <= 8 / (PX_PER_SAMPLE * zoom) ? near.index : null);
  };

  const clearHover = () => { setHover(null); setAt(null); };

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
    const minSize = el.clientWidth / (basePx * MAX_ZOOM);
    // The dragged edge can come no closer to the anchor than one minimum band width.
    const moved = edge === 'left'
      ? clamp(frac, 0, anchor - minSize)
      : clamp(frac, anchor + minSize, 1);
    const size = Math.abs(moved - anchor);
    const start = clamp(Math.min(moved, anchor), 0, 1 - size);

    const newZoom = clamp(el.clientWidth / (basePx * size), 1, MAX_ZOOM);
    pendingScrollLeftRef.current = start * basePx * newZoom;
    setLive(false);
    setZoom(newZoom);
  };

  const ticks = elapsedS && elapsedS.length >= 2
    ? timeTicks(elapsedS[0], elapsedS[elapsedS.length - 1],
      Math.max(2, Math.round(contentPx / PX_PER_TICK)))
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-body text-[var(--text-secondary)]">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {/* The instruction lives out here rather than in the card's band, which scrolls. */}
        <span className="ml-auto truncate text-label text-[var(--text-muted)]">
          {interventions.length
            ? `${interventions.length} actions — hover anywhere to read the numbers, click a pin for the chat`
            : 'pins appear here as windows close'}
        </span>
        <button onClick={toLive} disabled={live}
          className="flex shrink-0 items-center gap-1 text-label font-semibold transition-colors"
          style={{ color: live ? 'var(--text-muted)' : 'var(--kick-green)' }}>
          <span className="size-2 rounded-full"
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
          {/* The hover card's band. Anchored to the pin's own x and clamped to the chart's
              ends, so it stays beside what you hovered without ever running off the edge.
              `pointer-events-none` — it opens directly above the pin, and a card that could
              take the hover from the pin under it would flicker the moment it appeared. */}
          <div className="pointer-events-none relative" style={{ height: POP_H }}>
            {cursor !== null && (
              <article
                className="absolute bottom-1 rounded-sm border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
                style={{
                  left: centred(`${(cursor / (len - 1)) * 100}%`, `${POP_W}px`),
                  width: POP_W,
                  borderLeft: `3px solid ${shown ? VERDICT_COLOR[labelFor(shown)] : 'var(--text-secondary)'}`,
                }}
              >
                {shown ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-label font-bold tracking-[0.14em]"
                        style={{ color: VERDICT_COLOR[labelFor(shown)] }}>
                        {labelFor(shown).toUpperCase()}
                      </span>
                      <span className="min-w-0 truncate text-body text-[var(--text-secondary)]">
                        {ARM_LABEL[shown.arm]}
                      </span>
                      <span className="tnum ml-auto shrink-0 text-stat font-bold leading-none"
                        style={{ color: VERDICT_COLOR[labelFor(shown)] }}>
                        {points(shown.engagement_delta)}
                      </span>
                    </div>
                    {/* No timestamp: the shaded band below marks the measured 60s against
                        an axis that is already labelled, so printing the clock here is the
                        third place on screen saying when. */}
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-lead text-[var(--text-primary)]">
                        {shown.action?.body ? `“${shown.action.body}”` : '—'}
                      </span>
                      {!shown.contaminated && (
                        <span className="tnum shrink-0 text-label text-[var(--text-muted)]">
                          {peopleShort(shown.engagement_delta, viewers?.[cursor])}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  // Between pins: what the lines actually say here. A chart of counts that
                  // will not tell you a count makes you estimate one off a pixel height.
                  <>
                    <div className="tnum text-label text-[var(--text-muted)]">
                      {elapsedS?.[cursor] != null ? fmt(elapsedS[cursor]) : 'this moment'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      {series.map((s) => (
                        <span key={s.label} className="flex items-baseline gap-1.5">
                          <span className="size-2 shrink-0 self-center rounded-full"
                            style={{ background: s.color }} />
                          <span className="text-body text-[var(--text-secondary)]">{s.label}</span>
                          <span className="tnum text-lead font-bold text-[var(--text-primary)]">
                            {readout(s.data[cursor])}
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </article>
            )}
          </div>

          {/* Pins, above the plot rather than on it. A dashed hairline is easy to miss and
              impossible to aim at; a coloured pin says an action happened here and how it
              went before anyone hovers anything. They live in HTML, not the SVG, because
              the plot is stretched horizontally and would stretch a shape with it. */}
          <div className="relative h-3">
            {interventions.map(({ index, result: r }) => {
              const on = hover === index;
              const size = on ? 11 : 7;
              return (
                <span key={r.action_id}
                  onMouseEnter={() => { setHover(index); setAt(index); }}
                  onMouseLeave={clearHover}
                  onClick={() => onSelect?.(r)}
                  className="absolute bottom-0 block cursor-pointer rounded-[2px] transition-[width,height,opacity]"
                  style={{
                    left: centred(`${(index / (len - 1)) * 100}%`, `${size}px`),
                    width: size,
                    height: size,
                    background: VERDICT_COLOR[labelFor(r)],
                    opacity: on ? 1 : 0.85,
                  }} />
              );
            })}
          </div>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
            onMouseMove={(e) => hoverAt(e.clientX)}
            onMouseLeave={clearHover}
            onClick={() => shown && onSelect?.(shown)}
            style={{ display: 'block', width: '100%', height, cursor: shown ? 'pointer' : 'crosshair' }}
          >
            {series.map(({ data, color, scaleGroup, dim }, i) => {
              const max = scaleGroup ? groupMax(scaleGroup) : (Math.max(...data) * 1.15 || 1);
              return (
                <path key={i} d={line(data, max, height, 6, x)} fill="none" stroke={color}
                  strokeWidth={dim ? 1 : 1.75} opacity={dim ? 0.45 : 1}
                  vectorEffect="non-scaling-stroke" />
              );
            })}
            {/* The crosshair, only between pins — on a pin the marker's own line already
                goes solid, and two vertical rules at the same x is one too many. A bare
                line and no dots: `preserveAspectRatio="none"` stretches this box, so a
                circle drawn here comes out an ellipse. */}
            {at !== null && hover === null && (
              <line x1={x(at)} x2={x(at)} y1={0} y2={height} stroke="var(--text-secondary)"
                strokeWidth="1" opacity={0.55} vectorEffect="non-scaling-stroke" />
            )}
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
            <div className="tnum relative mt-1 h-5 text-label text-[var(--text-muted)]">
              {ticks.map((t) => (
                <span key={t} className="absolute whitespace-nowrap"
                  style={{
                    left: centred(`${(nearestIndex(elapsedS, t) / (len - 1)) * 100}%`, LABEL_CH),
                  }}>
                  {fmt(t)}
                </span>
              ))}
            </div>
          )}
        </div>
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
          else if (dragMode) resizeEdge(dragMode, e.clientX);
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
        {/* A grab strip over each band edge. Dragging one pivots on the other, which is
            why the anchor is the opposite edge. */}
        {([['left', view.start, view.start + view.size],
          ['right', view.start + view.size, view.start]] as const).map(([edge, at, anchor]) => (
          <rect key={edge} x={at * W - 4} y={0} width={8} height={MAP_H} fill="transparent"
            style={{ cursor: 'ew-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation();
              dragAnchorRef.current = anchor;
              setDragMode(edge);
            }} />
        ))}
      </svg>
    </div>
  );
}
