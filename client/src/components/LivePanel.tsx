// Live mode (prototype variant F): a floating, user-positioned panel the streamer parks
// over their OBS preview. One phase-driven slot plus an ambient participation sparkline —
// absent at rest, unmissable when it has something to say.
import { Zap, Check, Clock } from 'lucide-react';
import type { GambitState } from '../useGambit';
import { STATE_LABEL, VERDICT_COLOR, labelFor, pct, points } from '../types';

const SHELL =
  'w-[360px] rounded-xl border bg-[var(--bg-surface)] shadow-[0_18px_50px_-8px_rgba(0,0,0,0.85)]';

function Spark({ data, height = 22 }: { data: number[]; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const W = 320;
  const max = Math.max(...data) * 1.15 || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => height - (v / max) * (height - 3) - 1.5;
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      <path d={d} fill="none" stroke="var(--kick-green)" strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function LivePanel({ s, onDecide }: {
  s: GambitState;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
}) {
  const state = s.pending?.state ?? 'steady';
  const measuring = Object.values(s.inflight);
  const last = s.results.find((r) => r.outcome === 'fired');

  // DETECTED — the only moment it takes real space
  if (s.pending) {
    const a = s.pending;
    return (
      <div className={`${SHELL} p-5`} style={{ borderColor: 'var(--warn)' }}>
        <div className="flex items-center gap-1.5">
          <Zap size={15} className="text-[var(--warn)]" />
          <span className="text-[13px] font-bold tracking-[0.2em] text-[var(--warn)]">
            {STATE_LABEL[a.state]}
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">{a.kind}</span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">{a.reason}</p>

        <p className="mt-4 text-[20px] font-semibold leading-tight text-[var(--text-primary)]">
          “{a.body}”
        </p>

        <button onClick={() => onDecide(a.id, 'send')}
          className="mt-4 w-full rounded-lg bg-[var(--kick-green)] py-4 text-base font-bold text-black">
          Send to chat
        </button>
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span>picked with p={a.propensity.toFixed(2)} · {a.autonomy}</span>
          <button onClick={() => onDecide(a.id, 'dismiss')} className="underline">skip</button>
        </div>
      </div>
    );
  }

  // FIRED — quiet again, one number
  if (measuring.length) {
    return (
      <div className={`${SHELL} border-[var(--border)] px-4 py-3`}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] text-[var(--kick-green)]">
          <Clock size={11} /> MEASURING · {measuring.length} OPEN
        </div>
        <p className="mt-1.5 truncate text-[11px] text-[var(--text-secondary)]">
          “{measuring[0].body}”
        </p>
      </div>
    );
  }

  // RESTING — a pill. The sparkline is the proof of life.
  const label = last ? labelFor(last) : null;
  return (
    <div className={`${SHELL} border-[var(--border)] px-3 py-2`}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }} />
        <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          {STATE_LABEL[state]}
        </span>
        <span className="tnum text-[10px] text-[var(--text-secondary)]">
          {s.context ? pct(s.context.participation) : '—'} talking
        </span>
        <div className="ml-1 min-w-0 flex-1 opacity-70"><Spark data={s.spark} /></div>
        {last && (
          <span className="tnum shrink-0 text-[10px]" style={{ color: VERDICT_COLOR[label!] }}>
            <Check size={10} className="mr-0.5 inline" />
            {points(last.engagement_delta)}
          </span>
        )}
      </div>
    </div>
  );
}
