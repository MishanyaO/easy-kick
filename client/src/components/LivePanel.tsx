// Live mode (prototype variant F): a floating, user-positioned panel the streamer parks
// over their OBS preview. One phase-driven slot plus an ambient participation sparkline —
// absent at rest, unmissable when it has something to say.
import { Check, Clock } from 'lucide-react';
import type { GambitState } from '../useGambit';
import { STATE_LABEL, VERDICT_COLOR, labelFor, pct, points } from '../types';
import Spark from './Spark';
import ApprovalCard from './ApprovalCard';

// Docked sits on `--bg-surface`: its only host is `Insights`, whose body is `--bg-elevated`,
// so this is the darker inset — a card *in* the panel, not on it.
const FLOATING =
  'w-[360px] rounded-xl border bg-[var(--bg-surface)] shadow-[0_18px_50px_-8px_rgba(0,0,0,0.85)]';
const DOCKED = 'w-full rounded-sm border bg-[var(--bg-surface)]';

export default function LivePanel({ s, onDecide, docked = false }: {
  s: GambitState;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
  /** Render flush inside a host panel instead of floating over the preview. */
  docked?: boolean;
}) {
  const SHELL = docked ? DOCKED : FLOATING;
  const state = s.pending?.state ?? 'steady';
  const measuring = Object.values(s.inflight);
  const last = s.results.find((r) => r.outcome === 'fired');

  // DETECTED — the only moment it takes real space
  if (s.pending) {
    return (
      <ApprovalCard action={s.pending} bandit={s.bandit} onDecide={onDecide} docked={docked} />
    );
  }

  // FIRED — quiet again, one number. The live poll tally itself now lives in Chat, not here.
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
