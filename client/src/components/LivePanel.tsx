// Live mode (prototype variant F): a floating, user-positioned panel the streamer parks
// over their OBS preview. One phase-driven slot plus an ambient participation sparkline —
// absent at rest, unmissable when it has something to say.
import { Zap, Check, Clock } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  STATE_LABEL, VERDICT_COLOR, labelFor, pct, points, whyThisArm, type PollFrame,
} from '../types';

// Docked sits on `--bg-surface`: its only host is the Insights drawer, whose body is
// `--bg-elevated`, so this is the darker inset — a card *in* the drawer, not on it.
const FLOATING =
  'w-[360px] rounded-xl border bg-[var(--bg-surface)] shadow-[0_18px_50px_-8px_rgba(0,0,0,0.85)]';
const DOCKED = 'w-full rounded-sm border bg-[var(--bg-surface)]';

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

/**
 * The live poll. Chat is voting right now, which is the only moment in the whole loop where
 * a *viewer* does something — so it gets the slot rather than a countdown.
 *
 * Percentages are withheld below MIN_FOR_PCT. A poll that gets two votes is a real outcome
 * and must not look broken, but "100% yes" off two ballots is a lie told confidently; raw
 * counts are honest at any N, and the voter line says how thin the evidence is.
 */
const MIN_FOR_PCT = 10;

function Poll({ poll, docked }: { poll: PollFrame; docked: boolean }) {
  const total = Object.values(poll.votes).reduce((a, n) => a + n, 0);
  const top = Math.max(1, ...Object.values(poll.votes));
  return (
    <div className={docked ? 'mt-2' : 'mt-4'}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--kick-green)]">
          CHAT IS VOTING
        </span>
        <span className="tnum ml-auto text-[10px] text-[var(--text-muted)]">
          {poll.closes_in_s.toFixed(0)}s left
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {poll.options.map((option) => {
          const n = poll.votes[option] ?? 0;
          return (
            <div key={option} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-[12px] font-semibold text-[var(--text-primary)]">
                {option}
              </span>
              <div className="h-2 flex-1 rounded-sm bg-[var(--bg-surface)]">
                <div
                  className="h-2 rounded-sm bg-[var(--kick-green)] transition-[width] duration-500"
                  style={{ width: `${(n / top) * 100}%` }}
                />
              </div>
              <span className="tnum w-16 shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
                {n} vote{n === 1 ? '' : 's'}
                {total >= MIN_FOR_PCT && (
                  <span className="text-[var(--text-muted)]"> · {Math.round((n / total) * 100)}%</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        {total === 0
          ? 'no votes yet — the prompt is in chat'
          : `${poll.voters} viewer${poll.voters === 1 ? '' : 's'} voted · one vote each` +
            (total < MIN_FOR_PCT ? ' · too few to read as a split' : '')}
      </p>
    </div>
  );
}

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
    const a = s.pending;
    const why = whyThisArm(s.bandit, a.state, a.kind);
    return (
      <div className={`${SHELL} ${docked ? 'p-3' : 'p-5'}`} style={{ borderColor: 'var(--warn)' }}>
        <div className="flex items-center gap-1.5">
          <Zap size={docked ? 12 : 15} className="text-[var(--warn)]" />
          <span
            className={`font-bold tracking-[0.2em] text-[var(--warn)] ${docked ? 'text-[10px]' : 'text-[13px]'}`}
          >
            {STATE_LABEL[a.state]}
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">{a.kind}</span>
        </div>
        <p className={`text-[var(--text-muted)] ${docked ? 'mt-0.5 text-[10px]' : 'mt-1 text-[11px]'}`}>
          {a.reason}
        </p>

        <p
          className={`font-semibold leading-tight text-[var(--text-primary)] ${
            docked ? 'mt-2 text-[13px]' : 'mt-4 text-[20px]'
          }`}
        >
          “{a.body}”
        </p>

        <button
          onClick={() => onDecide(a.id, 'send')}
          className={`w-full bg-[var(--kick-green)] font-bold text-[var(--on-primary)] transition-colors hover:bg-[var(--kick-green-dim)] ${
            docked ? 'mt-2 rounded-sm py-1.5 text-xs' : 'mt-4 rounded-lg py-4 text-base'
          }`}
        >
          Send to chat
        </button>
        <div
          className={`flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)] ${
            docked ? 'mt-1.5' : 'mt-2'
          }`}
        >
          {/* Why this arm, not what probability produced it. Falls back to the propensity
              only when the bandit has published nothing to reason from. */}
          <span className="min-w-0 flex-1 truncate">
            {why ? (
              <>
                <span
                  className="mr-1 font-bold tracking-wider"
                  style={{ color: why.mode === 'explore' ? 'var(--warn)' : 'var(--kick-green)' }}
                >
                  {why.mode === 'explore' ? 'EXPLORING' : 'BACKING THE LEADER'}
                </span>
                {why.text}
              </>
            ) : (
              `picked with p=${a.propensity.toFixed(2)} · ${a.autonomy}`
            )}
          </span>
          <button onClick={() => onDecide(a.id, 'dismiss')} className="shrink-0 underline">
            skip
          </button>
        </div>
      </div>
    );
  }

  // FIRED — quiet again, one number. Unless chat is voting, which outranks the countdown.
  if (measuring.length) {
    return (
      <div className={`${SHELL} border-[var(--border)] px-4 py-3`}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] text-[var(--kick-green)]">
          <Clock size={11} /> MEASURING · {measuring.length} OPEN
        </div>
        <p className="mt-1.5 truncate text-[11px] text-[var(--text-secondary)]">
          “{measuring[0].body}”
        </p>
        {s.poll && <Poll poll={s.poll} docked={docked} />}
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
