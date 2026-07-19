import { MessageSquare, Users } from 'lucide-react';
import Rel from '../ui/Rel';
import { sentimentLabel } from '../ui/sentiment';
import type { InsightEvent } from '../../types';

/** Thin one-row strip: pace · people · mood, each paired with "× normal". */
export default function MetricsStrip({ insight }: { insight: InsightEvent }) {
  const senti = sentimentLabel(insight.sentiment);
  return (
    <div className="flex h-full items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <MessageSquare size={11} className="text-[var(--text-muted)]" />
        <span className="tnum text-sm font-bold">{insight.msgs_per_min}</span>
        <span className="text-[10px] text-[var(--text-muted)]">msgs/min</span>
        <Rel value={insight.vs_baseline.msgs_per_min} />
      </div>
      <div className="h-4 w-px bg-[var(--border)]" />
      <div className="flex items-center gap-1.5">
        <Users size={11} className="text-[var(--text-muted)]" />
        <span className="tnum text-sm font-bold">{insight.unique_chatters}</span>
        <span className="text-[10px] text-[var(--text-muted)]">chatting</span>
        <Rel value={insight.vs_baseline.unique_chatters} />
      </div>
      <div className="h-4 w-px bg-[var(--border)]" />
      <div className="flex items-center gap-1.5">
        <senti.Icon size={11} style={{ color: senti.color }} />
        <span className="tnum text-sm font-bold">{Math.round(insight.sentiment * 100)}%</span>
        <span className="text-[10px] font-semibold" style={{ color: senti.color }}>
          {senti.text}
        </span>
        <Rel value={insight.vs_baseline.sentiment} />
      </div>
    </div>
  );
}
