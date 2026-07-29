import { ExternalLink, LineChart, MessageCircleQuestion } from 'lucide-react';
import Panel from './Panel';
import ApprovalCard from '../components/ApprovalCard';
import type { GambitState } from '../useGambit';

/**
 * Ours, docked in the slot Kick's own (and, for us, permanently empty) Mod Actions panel
 * used to occupy: a scrollable list of what needs or had the streamer's attention — the
 * pending approval on top when there is one, followed by chat_digest history. The ambient
 * graphs live in Session Info now; closed windows and their verdicts live in Activity Feed
 * instead — this panel is about now and about-to-be-missed, not about history.
 */
export default function Insights({ s, onDecide }: {
  s: GambitState;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
}) {
  const empty = !s.pending && s.digests.length === 0;

  return (
    <Panel
      title="Insights"
      icon={<LineChart size={13} />}
      className="h-full"
      bodyClassName="flex flex-col overflow-hidden"
      actions={
        <a
          href={`${window.location.pathname}?insights`}
          target="_blank"
          rel="noopener"
          aria-label="Open Insights in a full tab"
          title="Open Insights in a full tab"
          className="flex size-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
        >
          <ExternalLink size={13} />
        </a>
      }
    >
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
    </Panel>
  );
}
