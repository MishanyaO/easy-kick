// The pending-decision card: a suggestion awaiting the streamer's send/skip, docked in
// `Insights` on the Kick-replica dashboard.
import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import type { ActionFrame, BanditFrame } from '../types';
import { ARM_LABEL, STATE_LABEL, asPrediction, whyThisArm } from '../types';

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
  // Null for every other arm, which is the switch between "a line we are about to say" and
  // "a widget we are about to open in Kick" — two different promises, so two different cards.
  const prediction = asPrediction(action.body);

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
        {/* The product name, not the wire name: `emote_rally` on a card a streamer reads is
            us showing them our variable names. */}
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {ARM_LABEL[action.kind]}
        </span>
      </div>
      <p className={`text-[var(--text-muted)] ${docked ? 'mt-0.5 text-[10px]' : 'mt-1 text-[11px]'}`}>
        {action.reason}
      </p>

      <p
        className={`font-semibold leading-tight text-[var(--text-primary)] ${
          docked ? 'mt-2 text-[13px]' : 'mt-4 text-[20px]'
        }`}
      >
        {prediction ? prediction.question : `“${action.body}”`}
      </p>

      {/* The two sides, shown the way the closed-poll banner shows options — a prediction is
          the one arm whose card cannot say what it is asking for otherwise, because the
          outcomes live inside the command string and `options` comes over the wire empty. */}
      {prediction && prediction.outcomes.length > 0 && (
        <div className={`flex gap-1.5 ${docked ? 'mt-1.5' : 'mt-3'}`}>
          {prediction.outcomes.map((outcome) => (
            <span
              key={outcome}
              className={`flex-1 truncate rounded-sm border border-[var(--border)] text-center font-semibold text-[var(--text-secondary)] ${
                docked ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[12px]'
              }`}
            >
              {outcome}
            </span>
          ))}
        </div>
      )}

      {/* Said before the button, not after it: this arm spends the viewers' Channel Points,
          which is the whole reason it can never be auto-approved (`prediction` is pinned to
          `ask` server-side), and a streamer should read that while deciding rather than
          discover it once Kick's widget is up. */}
      {prediction && (
        <p
          className={`text-[var(--text-muted)] ${docked ? 'mt-1.5 text-[10px]' : 'mt-3 text-[11px]'}`}
        >
          Opens Kick's prediction widget · viewers stake Channel Points
        </p>
      )}

      <button
        onClick={() => onDecide(action.id, 'send')}
        className={`w-full bg-[var(--kick-green)] font-bold text-[var(--on-primary)] transition-colors hover:bg-[var(--kick-green-dim)] ${
          docked ? 'mt-2 rounded-sm py-1.5 text-xs' : 'mt-4 rounded-lg py-4 text-base'
        }`}
      >
        {/* Keyed on the arm, not on the parse: a prediction whose wording we failed to read
            still opens a widget rather than posting a line, and the button must not promise
            the wrong thing just because the copy changed shape. */}
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
