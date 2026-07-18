import { useEffect, useState } from 'react';
import { motion, animate, useMotionValue, useTransform } from 'framer-motion';
import {
  Flame, Minus, TrendingDown, ArrowUpRight, ArrowDownRight,
  MessageSquare, Users, Smile, Meh, Frown, HelpCircle, Hash, GripVertical, EyeOff, Plus, Check, LayoutGrid,
  UserPlus, RotateCcw, Gem,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceDot, ReferenceArea,
} from 'recharts';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { InsightEvent } from '../types';

const Grid = WidthProvider(RGL);

export type HypePoint = { t: number; hype: number; spike: boolean };
export type ChatState = 'hot' | 'normal' | 'dying';

export function chatState(hype: number | null): ChatState {
  if (hype === null) return 'normal';
  if (hype >= 70) return 'hot';
  if (hype < 35) return 'dying';
  return 'normal';
}

const STATE_META: Record<ChatState, { label: string; color: string; Icon: typeof Flame; advice: string }> = {
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

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.6, ease: 'easeOut' });
    return controls.stop;
  }, [value, mv]);
  return <motion.span className="tnum">{rounded}</motion.span>;
}

function sentimentLabel(s: number): { text: string; color: string; Icon: typeof Meh } {
  if (s >= 0.65) return { text: 'positive', color: 'var(--kick-green)', Icon: Smile };
  if (s >= 0.45) return { text: 'mixed', color: 'var(--text-secondary)', Icon: Meh };
  return { text: 'negative', color: 'var(--danger)', Icon: Frown };
}

function Widget({
  title,
  icon,
  children,
  bare = false,
  onHide,
}: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  bare?: boolean;
  onHide?: () => void;
}) {
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
      <div className="widget-handle flex cursor-grab items-center gap-1.5 px-2.5 py-1.5 active:cursor-grabbing">
        <GripVertical size={11} className="text-[var(--text-muted)]" />
        {!bare && (
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
            {icon}
            {title}
          </span>
        )}
        {onHide && (
          <button
            onClick={onHide}
            onMouseDown={(e) => e.stopPropagation()}
            title="Hide widget"
            className="ml-auto rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
          >
            <EyeOff size={11} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">{children}</div>
    </div>
  );
}

const WIDGETS = [
  { id: 'hype', title: 'Hype score & trend' },
  { id: 'metrics', title: 'Pace · People · Mood' },
  { id: 'shoutouts', title: 'People to shout out' },
  { id: 'questions', title: 'Chat keeps asking' },
  { id: 'topics', title: 'Trending topics' },
] as const;

type WidgetId = (typeof WIDGETS)[number]['id'];

const DEFAULT_LAYOUT: Layout[] = [
  { i: 'hype', x: 0, y: 0, w: 12, h: 5, minH: 4, minW: 6 },
  { i: 'metrics', x: 0, y: 5, w: 12, h: 2, minH: 2, minW: 6 },
  { i: 'shoutouts', x: 0, y: 7, w: 5, h: 6, minH: 4, minW: 3 },
  { i: 'questions', x: 5, y: 7, w: 7, h: 6, minH: 4, minW: 4 },
  { i: 'topics', x: 0, y: 13, w: 12, h: 4, minH: 3, minW: 4 },
];

function Rel({ value }: { value: number }) {
  const up = value >= 1;
  return (
    <span
      className="tnum flex items-center gap-0.5 text-[10px] font-semibold"
      style={{ color: up ? 'var(--kick-green)' : 'var(--warn)' }}
    >
      {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {value.toFixed(1)}× normal
    </span>
  );
}

function timeAgo(ts: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

const SHOUTOUT_META = {
  first_time: { Icon: UserPlus, color: 'var(--text-secondary)' },
  returning: { Icon: RotateCcw, color: 'var(--text-secondary)' },
  new_sub: { Icon: Gem, color: 'var(--kick-green)' },
} as const;

export default function CenterPanel({
  insight,
  history,
  started,
}: {
  insight: InsightEvent | null;
  history: HypePoint[];
  started: boolean;
}) {
  const [layout, setLayout] = useState<Layout[]>(DEFAULT_LAYOUT);
  const [hidden, setHidden] = useState<Set<WidgetId>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleWidget = (id: WidgetId) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleLayout = layout.filter((l) => !hidden.has(l.i as WidgetId));

  const hype = insight?.hype ?? null;
  const state = chatState(hype);
  const meta = STATE_META[state];
  const spikes = history.filter((p) => p.spike);
  // snap annotations onto the visible series so labels sit on the actual peaks
  const tMin = history[0]?.t ?? 0;
  const tMax = history[history.length - 1]?.t ?? 0;
  const annos = (insight?.annotations ?? [])
    .filter((a) => a.t >= tMin && a.t <= tMax && history.length > 0)
    .map((a) => {
      const p = history.reduce((best, pt) =>
        Math.abs(pt.t - a.t) < Math.abs(best.t - a.t) ? pt : best,
      );
      return { ...a, t: p.t, hype: p.hype };
    });

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

  const senti = sentimentLabel(insight.sentiment);

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border bg-[var(--bg-surface)] transition-colors duration-500"
      style={{ borderColor: state === 'hot' ? 'var(--kick-green)' : 'var(--border)' }}
    >
      {/* toolbar */}
      <div className="relative flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <LayoutGrid size={12} className="text-[var(--text-secondary)]" />
        <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">STREAM DASHBOARD</span>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        >
          <Plus size={11} /> Widgets
        </button>
        {menuOpen && (
          <div className="absolute right-3 top-9 z-20 w-52 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-lg">
            {WIDGETS.map((w) => {
              const visible = !hidden.has(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => toggleWidget(w.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-base)]"
                >
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded border"
                    style={{
                      borderColor: visible ? 'var(--kick-green)' : 'var(--border)',
                      background: visible ? 'var(--kick-green)' : 'transparent',
                    }}
                  >
                    {visible && <Check size={10} className="text-black" />}
                  </span>
                  {w.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Grid
          layout={visibleLayout}
          cols={12}
          rowHeight={30}
          margin={[10, 10]}
          draggableHandle=".widget-handle"
          compactType="vertical"
          onLayoutChange={(l) => {
            // merge visible layout back with hidden widgets' saved positions
            setLayout((prev) => {
              const hiddenLayout = prev.filter((p) => hidden.has(p.i as WidgetId));
              return [...l, ...hiddenLayout];
            });
          }}
        >
        {/* HYPE hero: number + chip left, trend right */}
        {!hidden.has('hype') && (
        <div key="hype">
          <Widget bare onHide={() => toggleWidget('hype')}>
            <div className="flex h-full items-center gap-4">
              <div className="flex flex-col items-start gap-1.5">
                <div className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
                  HYPE (0–100)
                </div>
                <div
                  className="tnum text-[76px] font-extrabold leading-none tracking-tight transition-colors duration-500"
                  style={{ color: meta.color }}
                >
                  <AnimatedNumber value={hype ?? 0} />
                </div>
                <div
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors duration-500"
                  style={{ borderColor: meta.color, color: meta.color }}
                  role="status"
                  aria-label={`chat is ${meta.label.toLowerCase()}`}
                >
                  <meta.Icon size={13} />
                  <span className="text-xs font-bold tracking-wider">{meta.label}</span>
                </div>
                <Rel value={insight.vs_baseline.hype} />
              </div>
              <div className="flex h-full min-w-0 flex-1 flex-col gap-1">
                <div className="h-[100px] min-h-0 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 6, right: 2, bottom: 0, left: -22 }}>
                      <XAxis dataKey="t" hide />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[35, 70]}
                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <ReferenceArea
                        y1={insight.baseline.low}
                        y2={insight.baseline.high}
                        fill="var(--text-muted)"
                        fillOpacity={0.08}
                      />
                      <ReferenceArea y1={70} y2={100} fill="var(--kick-green)" fillOpacity={0.05} />
                      <ReferenceArea y1={0} y2={35} fill="var(--warn)" fillOpacity={0.05} />
                      <Area
                        type="monotone"
                        dataKey="hype"
                        stroke={
                          state === 'hot'
                            ? 'var(--kick-green)'
                            : state === 'dying'
                              ? 'var(--warn)'
                              : 'var(--text-secondary)'
                        }
                        strokeWidth={2}
                        fill={state === 'hot' ? 'var(--kick-green)' : 'var(--bg-elevated)'}
                        fillOpacity={state === 'hot' ? 0.12 : 0.5}
                        isAnimationActive={false}
                      />
                      {spikes.map((s, i) => (
                        <ReferenceDot key={i} x={s.t} y={s.hype} r={3} fill="var(--kick-green)" stroke="none" />
                      ))}
                      {annos.map((a, i) => (
                        <ReferenceDot
                          key={`a${i}`}
                          x={a.t}
                          y={a.hype}
                          r={2}
                          fill="var(--text-secondary)"
                          stroke="none"
                          label={{
                            value: a.label,
                            position: 'top',
                            fill: 'var(--text-secondary)',
                            fontSize: 9,
                          }}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
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
          </Widget>
        </div>
        )}

        {/* Metrics — thin strip */}
        {!hidden.has('metrics') && (
        <div key="metrics">
          <Widget bare onHide={() => toggleWidget('metrics')}>
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
          </Widget>
        </div>
        )}

        {/* People to shout out */}
        {!hidden.has('shoutouts') && (
        <div key="shoutouts">
          <Widget title="PEOPLE TO SHOUT OUT" icon={<UserPlus size={10} />} onHide={() => toggleWidget('shoutouts')}>
            {insight.shoutouts.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Listening for new faces, returning regulars and fresh subs…
              </p>
            ) : (
              <div className="space-y-1.5">
                {[...insight.shoutouts].reverse().map((s) => {
                  const m = SHOUTOUT_META[s.kind];
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <m.Icon size={11} style={{ color: m.color }} className="shrink-0" />
                      <span className="shrink-0 text-sm font-semibold text-[var(--text-primary)]">
                        {s.username}
                      </span>
                      <span className="truncate text-[11px] text-[var(--text-secondary)]">{s.detail}</span>
                      <span className="tnum ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
                        {timeAgo(s.ts)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Widget>
        </div>
        )}

        {/* Questions */}
        {!hidden.has('questions') && (
        <div key="questions">
          <Widget title="CHAT KEEPS ASKING — ANSWER ON STREAM" icon={<HelpCircle size={10} />} onHide={() => toggleWidget('questions')}>
            {insight.questions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No repeated questions right now.</p>
            ) : (
              <div className="space-y-1.5">
                {insight.questions.map((q) => (
                  <div key={q.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-[var(--text-primary)]">“{q.text}”</span>
                    <span className="tnum shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warn)]">
                      asked {q.count}×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>
        )}

        {/* Topics */}
        {!hidden.has('topics') && (
        <div key="topics">
          <Widget title="TRENDING TOPICS" icon={<Hash size={10} />} onHide={() => toggleWidget('topics')}>
            <div className="flex flex-wrap gap-1.5">
              {insight.top_topics.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]"
                >
                  {t}
                </span>
              ))}
              {insight.top_emotes.map((e) => (
                <span
                  key={e}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-bold text-[var(--kick-green)]"
                >
                  {e}
                </span>
              ))}
            </div>
          </Widget>
        </div>
        )}
        </Grid>
      </div>
    </div>
  );
}
