import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceDot, ReferenceArea,
} from 'recharts';
import type { Annotation } from '../../types';
import { chatState, type ChatState } from '../ui/StateChip';

export type HypePoint = { t: number; hype: number; spike: boolean };

/**
 * Hype-over-time area chart with:
 * - faint band marking the streamer's normal range ("unusual" = line leaves the band)
 * - hot/quiet threshold zones
 * - green dots on detected spikes
 * - small text labels on named moments ("opened the case"), snapped to the nearest point
 */
export default function HypeTimeline({
  history,
  baseline,
  annotations = [],
  height = 100,
}: {
  history: HypePoint[];
  baseline: { low: number; high: number };
  annotations?: Annotation[];
  height?: number;
}) {
  const state: ChatState = chatState(history[history.length - 1]?.hype ?? null);
  const spikes = history.filter((p) => p.spike);

  const tMin = history[0]?.t ?? 0;
  const tMax = history[history.length - 1]?.t ?? 0;
  const annos = annotations
    .filter((a) => a.t >= tMin && a.t <= tMax && history.length > 0)
    .map((a) => {
      const p = history.reduce((best, pt) =>
        Math.abs(pt.t - a.t) < Math.abs(best.t - a.t) ? pt : best,
      );
      return { ...a, t: p.t, hype: p.hype };
    });

  return (
    <div style={{ height }} className="min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ top: 6, right: 2, bottom: 0, left: -22 }}>
          <XAxis dataKey="t" hide />
          <YAxis
            domain={[0, 100]}
            ticks={[35, 70]}
            tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceArea y1={baseline.low} y2={baseline.high} fill="var(--text-muted)" fillOpacity={0.08} />
          <ReferenceArea y1={70} y2={100} fill="var(--kick-green)" fillOpacity={0.05} />
          <ReferenceArea y1={0} y2={35} fill="var(--warn)" fillOpacity={0.05} />
          <Area
            type="monotone"
            dataKey="hype"
            stroke={
              state === 'hot'
                ? 'var(--kick-green)'
                : state === 'dying'
                  ? 'var(--warn)'
                  : 'var(--text-secondary)'
            }
            strokeWidth={2}
            fill={state === 'hot' ? 'var(--kick-green)' : 'var(--bg-elevated)'}
            fillOpacity={state === 'hot' ? 0.12 : 0.5}
            isAnimationActive={false}
          />
          {spikes.map((s, i) => (
            <ReferenceDot key={i} x={s.t} y={s.hype} r={3} fill="var(--kick-green)" stroke="none" />
          ))}
          {annos.map((a, i) => (
            <ReferenceDot
              key={`a${i}`}
              x={a.t}
              y={a.hype}
              r={2}
              fill="var(--text-secondary)"
              stroke="none"
              label={{ value: a.label, position: 'top', fill: 'var(--text-secondary)', fontSize: 9 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
