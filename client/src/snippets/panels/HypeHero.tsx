import AnimatedNumber from '../ui/AnimatedNumber';
import Rel from '../ui/Rel';
import StateChip, { chatState, STATE_META } from '../ui/StateChip';
import HypeTimeline, { type HypePoint } from '../charts/HypeTimeline';
import type { InsightEvent } from '../../types';

/**
 * The glanceable hero: huge hype number + state chip (left), annotated
 * 5-minute timeline (right), one-line advice underneath.
 */
export default function HypeHero({
  insight,
  history,
}: {
  insight: InsightEvent;
  history: HypePoint[];
}) {
  const state = chatState(insight.hype);
  const meta = STATE_META[state];

  return (
    <div className="flex h-full items-center gap-4">
      <div className="flex flex-col items-start gap-1.5">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
          HYPE (0–100)
        </div>
        <div
          className="tnum text-[76px] font-extrabold leading-none tracking-tight transition-colors duration-500"
          style={{ color: meta.color }}
        >
          <AnimatedNumber value={insight.hype} />
        </div>
        <StateChip state={state} />
        <Rel value={insight.vs_baseline.hype} />
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col gap-1">
        <div className="min-h-0 flex-1">
          <HypeTimeline
            history={history}
            baseline={insight.baseline}
            annotations={insight.annotations}
          />
        </div>
        <div className="flex items-baseline justify-between px-1">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
            LAST 5 MINUTES
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            <span className="text-[var(--kick-green)]">●</span> spike · grey band = your normal range
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{meta.advice}</p>
      </div>
    </div>
  );
}

export type { HypePoint };
