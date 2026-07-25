import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, HelpCircle, Flame, Hand, Coins, Minus, Zap, TrendingUp, Sparkles,
} from 'lucide-react';
import type { ActionEvent, ActionResult, Arm } from '../types';
import VoteBars from '../snippets/actions/VoteBars';

const KIND_ICON: Record<Arm, typeof BarChart3> = {
  nothing: Minus,
  emote_rally: Flame,
  chat_poll: BarChart3,
  question_relay: HelpCircle,
  shoutout: Hand,
  prediction: Coins,
};

function ActionCard({
  action,
  result,
  primary,
  onSend,
  onDismiss,
}: {
  action: ActionEvent;
  result?: ActionResult;
  primary: boolean;
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const Icon = KIND_ICON[action.kind];
  const decayed = action.status === 'suggested' && !primary;
  const quiet = decayed || action.status === 'dismissed';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: quiet ? 0.55 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className="rounded-lg border bg-[var(--bg-elevated)] p-3"
      style={{
        borderColor:
          action.status === 'live'
            ? 'var(--kick-green)'
            : primary && action.status === 'suggested'
              ? 'var(--text-muted)'
              : 'var(--border)',
      }}
    >
      {/* REASON first — this is the intelligence */}
      <div className="flex items-start gap-1.5">
        <Zap size={12} className="mt-0.5 shrink-0 text-[var(--warn)]" />
        <p className={`text-xs font-semibold leading-snug ${quiet ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
          {action.reason}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[var(--text-secondary)]">
        <Icon size={12} />
        <span className="text-[10px] font-bold uppercase tracking-widest">{action.kind}</span>
        {action.auto_fire && action.status === 'suggested' && (
          <span className="ml-auto text-[10px] text-[var(--text-muted)]">auto-fires soon</span>
        )}
      </div>
      <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{action.title}</p>

      {action.status === 'suggested' && (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {action.options.map((o) => (
              <span key={o} className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                {o}
              </span>
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => onSend(action.id)}
              className="rounded-md px-3 py-1.5 text-xs font-bold text-black transition-colors"
              style={{ background: 'var(--kick-green)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--kick-green-dim)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--kick-green)')}
            >
              Send
            </button>
            <button
              onClick={() => onDismiss(action.id)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
            >
              Dismiss
            </button>
          </div>
        </>
      )}

      {action.status === 'live' && (
        <>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--kick-green)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--kick-green)]" /> live in chat
          </div>
          <VoteBars action={action} result={result} />
        </>
      )}

      {action.status === 'closed' && result && (
        <>
          <VoteBars action={action} result={result} />
          <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--bg-base)] px-2 py-1 text-xs font-bold text-[var(--kick-green)]">
            <TrendingUp size={12} />
            {result.engagement_delta >= 0 ? '+' : ''}
            {Math.round(result.engagement_delta * 100)}% engagement
          </div>
        </>
      )}

      {action.status === 'dismissed' && (
        <div className="mt-1.5 text-[11px] italic text-[var(--text-muted)]">dismissed</div>
      )}
    </motion.div>
  );
}

export default function ActionFeed({
  actions,
  results,
  onSend,
  onDismiss,
}: {
  actions: ActionEvent[];
  results: Record<string, ActionResult>;
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const sorted = [...actions].sort((a, b) => b.ts.localeCompare(a.ts));
  const primaryId = sorted.find((a) => a.status === 'suggested')?.id;

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Sparkles size={13} className="text-[var(--text-secondary)]" />
        <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">CO-PILOT</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Sparkles size={20} className="text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">
              Co-pilot is watching chat.<br />It will suggest polls &amp; trivia here when engagement dips or spikes.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sorted.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                result={results[a.id]}
                primary={a.id === primaryId}
                onSend={onSend}
                onDismiss={onDismiss}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
