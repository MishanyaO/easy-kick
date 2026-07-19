import { HelpCircle, Hash, UserPlus } from 'lucide-react';
import WidgetGrid, { type WidgetDef } from '../snippets/ui/WidgetGrid';
import HypeHero, { type HypePoint } from '../snippets/panels/HypeHero';
import MetricsStrip from '../snippets/panels/MetricsStrip';
import ShoutoutsPanel from '../snippets/panels/ShoutoutsPanel';
import QuestionsPanel from '../snippets/panels/QuestionsPanel';
import TopicsPanel from '../snippets/panels/TopicsPanel';
import { chatState } from '../snippets/ui/StateChip';
import type { InsightEvent } from '../types';

export type { HypePoint };

const DEFAULT_LAYOUT = [
  { i: 'hype', x: 0, y: 0, w: 12, h: 5, minH: 4, minW: 6 },
  { i: 'metrics', x: 0, y: 5, w: 12, h: 2, minH: 2, minW: 6 },
  { i: 'shoutouts', x: 0, y: 7, w: 5, h: 6, minH: 4, minW: 3 },
  { i: 'questions', x: 5, y: 7, w: 7, h: 6, minH: 4, minW: 4 },
  { i: 'topics', x: 0, y: 13, w: 12, h: 4, minH: 3, minW: 4 },
];

export default function CenterPanel({
  insight,
  history,
  started,
}: {
  insight: InsightEvent | null;
  history: HypePoint[];
  started: boolean;
}) {
  if (!started || !insight) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-center">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--kick-green)]" />
        <p className="text-sm text-[var(--text-secondary)]">Warming up…</p>
        <p className="max-w-[240px] text-xs text-[var(--text-muted)]">
          Listening to chat. Hype score, trends and chat questions appear after the first
          analysis window (~5s).
        </p>
      </div>
    );
  }

  const widgets: WidgetDef[] = [
    {
      id: 'hype',
      title: 'Hype score & trend',
      node: <HypeHero insight={insight} history={history} />,
    },
    {
      id: 'metrics',
      title: 'Pace · People · Mood',
      node: <MetricsStrip insight={insight} />,
    },
    {
      id: 'shoutouts',
      title: 'People to shout out',
      header: 'PEOPLE TO SHOUT OUT',
      icon: <UserPlus size={10} />,
      node: <ShoutoutsPanel shoutouts={insight.shoutouts} />,
    },
    {
      id: 'questions',
      title: 'Chat keeps asking',
      header: 'CHAT KEEPS ASKING — ANSWER ON STREAM',
      icon: <HelpCircle size={10} />,
      node: <QuestionsPanel questions={insight.questions} />,
    },
    {
      id: 'topics',
      title: 'Trending topics',
      header: 'TRENDING TOPICS',
      icon: <Hash size={10} />,
      node: <TopicsPanel topics={insight.top_topics} emotes={insight.top_emotes} />,
    },
  ];

  const state = chatState(insight.hype);
  return (
    <WidgetGrid
      title="STREAM DASHBOARD"
      widgets={widgets}
      defaultLayout={DEFAULT_LAYOUT}
      frameStyle={{ borderColor: state === 'hot' ? 'var(--kick-green)' : 'var(--border)' }}
    />
  );
}
