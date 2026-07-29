// One graph for viewers, active viewers and actions, with the intervention ledger
// overlaid as vertical markers on the same timeline — hovering one shows what fired
// and the lift it produced, right where it happened. Shows the whole session by
// default; drag across the graph to zoom into a range, "reset zoom" to back out.
import { useRef, useState } from 'react';
import { points, VERDICT_COLOR, labelFor, type ResultFrame, type ActionFrame } from '../types';

export type GraphSeries = { data: number[]; color: string; label: string; scaleGroup?: string };
export type Intervention = { index: number; result: ResultFrame & { action?: ActionFrame } };

const W = 640;
const MIN_ZOOM_SPAN = 3; // fewer than this and there's nothing meaningful to zoom into

export default function InsightsGraph({
  series, interventions, height = 96,
}: { series: GraphSeries[]; interventions: Intervention[]; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);

  const len = Math.max(0, ...series.map((s) => s.data.length));
  if (len < 2) return <div style={{ height }} />;

  const [lo, hi] = zoom ?? [0, len - 1];
  const visLen = hi - lo + 1;
  const x = (i: number) => ((i - lo) / (visLen - 1)) * W;

  const idxAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return lo;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return lo + Math.round(frac * (visLen - 1));
  };

  const groupMax = (group: string) => (Math.max(
    1, ...series.filter((s) => s.scaleGroup === group)
      .flatMap((s) => s.data.slice(lo, hi + 1)),
  ) * 1.15);

  const visibleInterventions = interventions.filter((iv) => iv.index >= lo && iv.index <= hi);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="size-1.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {zoom && (
          <button onClick={() => setZoom(null)}
            className="ml-auto text-[10px] font-semibold text-[var(--kick-green)] hover:underline">
            reset zoom
          </button>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
        className="mt-1.5 cursor-crosshair" style={{ display: 'block', width: '100%', height }}
        onMouseDown={(e) => setDrag([idxAt(e.clientX), idxAt(e.clientX)])}
        onMouseMove={(e) => {
          if (drag) setDrag([drag[0], idxAt(e.clientX)]);
        }}
        onMouseUp={() => {
          if (drag) {
            const [a, b] = [Math.min(...drag), Math.max(...drag)];
            if (b - a >= MIN_ZOOM_SPAN) setZoom([a, b]);
          }
          setDrag(null);
        }}
        onMouseLeave={() => setDrag(null)}
      >
        {series.map(({ data, color, scaleGroup }, i) => {
          const visible = data.slice(lo, hi + 1);
          if (visible.length < 2) return null;
          const max = scaleGroup ? groupMax(scaleGroup) : (Math.max(...visible) * 1.15 || 1);
          const y = (v: number) => height - (v / max) * (height - 6) - 3;
          const d = visible
            .map((v, j) => `${j === 0 ? 'M' : 'L'}${x(lo + j).toFixed(1)},${y(v).toFixed(1)}`)
            .join(' ');
          return (
            <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.5"
              vectorEffect="non-scaling-stroke" />
          );
        })}
        {visibleInterventions.map(({ index, result: r }) => (
          <g key={r.action_id}>
            <line x1={x(index)} x2={x(index)} y1={0} y2={height}
              stroke={VERDICT_COLOR[labelFor(r)]} strokeWidth={hover === index ? 2 : 1}
              strokeDasharray="2,2" opacity={hover === index ? 1 : 0.5} />
            {/* wide, invisible hit area — the dashed line itself is too thin to hover */}
            <line x1={x(index)} x2={x(index)} y1={0} y2={height}
              stroke="transparent" strokeWidth={10}
              onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }} />
          </g>
        ))}
        {drag && (
          <rect x={x(Math.min(...drag))} y={0} width={Math.abs(x(drag[1]) - x(drag[0]))} height={height}
            fill="var(--kick-green)" opacity={0.12} />
        )}
      </svg>
      {visibleInterventions.filter((iv) => iv.index === hover).map(({ index, result: r }) => (
        <div key={r.action_id}
          className="pointer-events-none absolute top-6 z-10 w-52 -translate-x-1/2 rounded-sm border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11px] shadow-lg"
          style={{ left: `${((index - lo) / (visLen - 1)) * 100}%` }}>
          <div className="font-semibold" style={{ color: VERDICT_COLOR[labelFor(r)] }}>
            {labelFor(r)} · {r.arm}
          </div>
          {r.action?.body && (
            <div className="mt-0.5 truncate text-[var(--text-secondary)]">“{r.action.body}”</div>
          )}
          <div className="mt-0.5 text-[var(--text-muted)]">lift {points(r.engagement_delta)}</div>
        </div>
      ))}
    </div>
  );
}
