// The Insights panel's body, factored out so the docked panel and its popout are the same
// thing rather than two things that look alike.
//
// That sameness is the whole point of the popout: Kick's popout icon promises "this panel,
// in its own window", and a popout that rendered different content would be a broken
// promise wearing a familiar affordance. The fuller, different view lives behind its own
// button, at `?review`.
import { MessageCircleQuestion } from 'lucide-react';
import ApprovalCard from '../components/ApprovalCard';
import type { GambitState } from '../useGambit';

export default function InsightsPanel({ s, onDecide }: {
  s: GambitState;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
}) {
  const empty = !s.pending && s.digests.length === 0;

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {empty ? (
        <div className="flex h-full items-center justify-center px-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">Nothing needs you right now.</p>
        </div>
      ) : (
        <>
          {s.pending && (
            <ApprovalCard action={s.pending} bandit={s.bandit} onDecide={onDecide} docked />
          )}

          {s.digests.map((d) => (
            <div
              key={d.ts}
              className="rounded-sm border border-[var(--border)] bg-[var(--bg-surface)] p-2"
            >
              <div className="flex items-center gap-1.5">
                <MessageCircleQuestion size={11} className="text-[var(--text-muted)]" />
                <span className="text-[10px] font-bold tracking-widest text-[var(--text-muted)]">
                  {d.title.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-[var(--text-primary)]">
                {d.body}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
