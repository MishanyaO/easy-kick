import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ActionEvent, ActionResult } from '../../types';

/** Simulates incoming votes while an action is live; real votes win once a result arrives. */
export function useLiveVotes(action: ActionEvent, result?: ActionResult) {
  const [votes, setVotes] = useState<Record<string, number>>({});
  useEffect(() => {
    if (action.status !== 'live') return;
    const iv = setInterval(() => {
      setVotes((v) => {
        const next = { ...v };
        const opt = action.options[Math.floor(Math.random() * action.options.length)];
        next[opt] = (next[opt] ?? 0) + 1 + Math.floor(Math.random() * 3);
        return next;
      });
    }, 700);
    return () => clearInterval(iv);
  }, [action.status, action.options]);
  return result ? result.votes : votes;
}

/** Animated per-option vote bars (green fill, tabular counts). */
export default function VoteBars({ action, result }: { action: ActionEvent; result?: ActionResult }) {
  const votes = useLiveVotes(action, result);
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="mt-2 space-y-1.5">
      {action.options.map((opt) => {
        const pct = Math.round(((votes[opt] ?? 0) / total) * 100);
        return (
          <div key={opt}>
            <div className="flex justify-between text-[11px]">
              <span className="text-[var(--text-secondary)]">{opt}</span>
              <span className="tnum text-[var(--text-muted)]">{votes[opt] ?? 0}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-[var(--bg-elevated)]">
              <motion.div
                className="h-full rounded"
                style={{ background: 'var(--kick-green)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
