import { UserPlus, RotateCcw, Gem } from 'lucide-react';
import type { Shoutout } from '../../types';

export function timeAgo(ts: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

const SHOUTOUT_META = {
  first_time: { Icon: UserPlus, color: 'var(--text-secondary)' },
  returning: { Icon: RotateCcw, color: 'var(--text-secondary)' },
  new_sub: { Icon: Gem, color: 'var(--kick-green)' },
} as const;

/** Newest-first list of people worth naming on stream: first-timers, returning regulars, unthanked subs. */
export default function ShoutoutsPanel({ shoutouts }: { shoutouts: Shoutout[] }) {
  if (shoutouts.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Listening for new faces, returning regulars and fresh subs…
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {[...shoutouts].reverse().map((s) => {
        const m = SHOUTOUT_META[s.kind];
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <m.Icon size={11} style={{ color: m.color }} className="shrink-0" />
            <span className="shrink-0 text-sm font-semibold text-[var(--text-primary)]">{s.username}</span>
            <span className="truncate text-[11px] text-[var(--text-secondary)]">{s.detail}</span>
            <span className="tnum ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">{timeAgo(s.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}
