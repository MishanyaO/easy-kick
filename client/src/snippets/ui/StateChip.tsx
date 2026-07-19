import { Flame, Minus, TrendingDown } from 'lucide-react';

export type ChatState = 'hot' | 'normal' | 'dying';

export function chatState(hype: number | null): ChatState {
  if (hype === null) return 'normal';
  if (hype >= 70) return 'hot';
  if (hype < 35) return 'dying';
  return 'normal';
}

export const STATE_META: Record<
  ChatState,
  { label: string; color: string; Icon: typeof Flame; advice: string }
> = {
  hot: {
    label: 'HOT',
    color: 'var(--kick-green)',
    Icon: Flame,
    advice: 'Chat is peaking — clip this moment and ride the momentum.',
  },
  normal: {
    label: 'STEADY',
    color: 'var(--text-primary)',
    Icon: Minus,
    advice: 'Engagement is steady — keep doing what you’re doing.',
  },
  dying: {
    label: 'DYING',
    color: 'var(--warn)',
    Icon: TrendingDown,
    advice: 'Chat is going quiet — fire a poll or trivia from the co-pilot.',
  },
};

/** Icon + word chip so chat state is never encoded in colour alone. */
export default function StateChip({ state }: { state: ChatState }) {
  const meta = STATE_META[state];
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors duration-500"
      style={{ borderColor: meta.color, color: meta.color }}
      role="status"
      aria-label={`chat is ${meta.label.toLowerCase()}`}
    >
      <meta.Icon size={13} />
      <span className="text-xs font-bold tracking-wider">{meta.label}</span>
    </div>
  );
}
