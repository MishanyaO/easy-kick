// The pending-decision card: a suggestion awaiting the streamer's send/skip, docked in
// `Insights` on the Kick-replica dashboard.
import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import type { ActionFrame, BanditFrame } from '../types';
import { STATE_LABEL, whyThisArm } from '../types';

const FLOATING =
  'w-[360px] rounded-xl border bg-[var(--bg-surface)] shadow-[0_18px_50px_-8px_rgba(0,0,0,0.85)]';
const DOCKED = 'w-full rounded-sm border bg-[var(--bg-surface)]';

/** A suggestion is perishable: it gets EXPIRY_MS to be acted on, drains a bar along the
 *  card's bottom edge while it waits, and skips itself at zero. Skipping is `dismiss`,
 *  which is the honest verb — a dismissal updates the streamer-preference counter and
 *  never the arm's chat-response posterior, so an unattended suggestion cannot teach the
 *  bandit that its tactic failed. */
const EXPIRY_MS = 5_000;

export default function ApprovalCard({ action, bandit, onDecide, docked = false }: {
  action: ActionFrame;
  bandit: BanditFrame | null;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
  docked?: boolean;
}) {
  const SHELL = docked ? DOCKED : FLOATING;
  const why = whyThisArm(bandit, action.state, action.kind);

  const [left, setLeft] = useState(1);
  // Held in a ref so the effect keys on the action id alone, not on `onDecide` identity.
  const onDecideRef = useRef(onDecide);
  onDecideRef.current = onDecide;

  useEffect(() => {
    const started = performance.now();
    setLeft(1);
    let done = false;
    const tick = () => {
      const remaining = 1 - (performance.now() - started) / EXPIRY_MS;
      if (remaining > 0) {
        setLeft(remaining);
        return;
      }
      // The interval is cleared on the next line, but a re-entrant tick before React
      // re-renders would fire a second decide() for the same id.
      if (done) return;
      done = true;
      setLeft(0);
      clearInterval(id);
      onDecideRef.current(action.id, 'dismiss');
    };
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, [action.id]);

  return (
    <div
      className={`relative overflow-hidden ${SHELL} ${docked ? 'p-3' : 'p-5'}`}
      style={{ borderColor: 'var(--warn)' }}
    >
      <div className="flex items-center gap-1.5">
        <Zap size={docked ? 12 : 15} className="text-[var(--warn)]" />
        <span
          className={`font-bold tracking-[0.2em] text-[var(--warn)] ${docked ? 'text-[10px]' : 'text-[13px]'}`}
        >
          {STATE_LABEL[action.state]}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">{action.kind}</span>
      </div>
      <p className={`text-[var(--text-muted)] ${docked ? 'mt-0.5 text-[10px]' : 'mt-1 text-[11px]'}`}>
        {action.reason}
      </p>

      <p
        className={`font-semibold leading-tight text-[var(--text-primary)] ${
          docked ? 'mt-2 text-[13px]' : 'mt-4 text-[20px]'
        }`}
      >
        “{action.body}”
      </p>

      <button
        onClick={() => onDecide(action.id, 'send')}
        className={`w-full bg-[var(--kick-green)] font-bold text-[var(--on-primary)] transition-colors hover:bg-[var(--kick-green-dim)] ${
          docked ? 'mt-2 rounded-sm py-1.5 text-xs' : 'mt-4 rounded-lg py-4 text-base'
        }`}
      >
        {action.kind === 'prediction' ? 'Start prediction' : 'Send to chat'}
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
            `picked with p=${action.propensity.toFixed(2)} · ${action.autonomy}`
          )}
        </span>
        <button onClick={() => onDecide(action.id, 'dismiss')} className="shrink-0 underline">
          skip
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-sm bg-black/40">
        <div
          className="h-full bg-[var(--kick-green)]"
          style={{ width: `${Math.max(0, left) * 100}%` }}
        />
      </div>
    </div>
  );
}
