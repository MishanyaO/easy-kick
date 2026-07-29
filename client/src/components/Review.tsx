// Review mode — R7 on real data. Rows grouped by verdict, state tiles that summarise and
// filter, and a Tactics tab reading the live bandit posteriors.
//
// Every group collapses and every row opens. Both matter for the same reason: the ledger
// has one line per decision and a session takes hundreds, so the default view has to be
// scannable by someone mid-stream, and the depth has to be one click away rather than
// spread across every row at once.
import { useState, type ReactNode } from 'react';
import { ChevronRight, FlaskConical, Radar } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  ARM_LABEL, NOISE_BAND, STATE_LABEL, VERDICT_COLOR, labelFor, isControl, points, pct,
  peopleShort, whyUnattributable,
  type Arm, type ChatState, type VerdictLabel,
} from '../types';
import InsightsGraph from './InsightsGraph';
import ResultDetail, { type History, type LedgerRow } from './ResultDetail';

type Row = LedgerRow;
type Filter = 'all' | ChatState;

/**
 * Every group starts collapsed, and the header has to survive that.
 *
 * A session produces hundreds of windows, so the useful default is a page you can take in
 * at a glance and drill into — not four expanded lists. That only works if a collapsed
 * header still says everything the group would: how many, what kind, and what it came to.
 * Summarising it is fine; hiding it is not.
 */
const GROUPS: { verdict: VerdictLabel; blurb: string }[] = [
  { verdict: 'Worked', blurb: 'do more of these' },
  { verdict: 'Neutral', blurb: 'chat did not move' },
  { verdict: 'Backfired', blurb: 'chat got quieter after — avoid these' },
  { verdict: "Can't tell", blurb: 'no verdict is possible for these' },
];

const STATES: ChatState[] = ['lull', 'steady', 'spike'];
const ARM_COLORS = ['var(--kick-green)', 'var(--warn)', 'var(--text-secondary)', '#6aa9ff', '#ff7ad9'];
/** A tactic needs this many tries in a state before its average is worth reading aloud. */
const MIN_TRIES = 2;

/** A window that never reached chat: skipped, expired, or the send itself failed. */
const isUnsent = (r: Row) => r.outcome === 'dismissed' || r.outcome === 'send_failed';

/** One ledger row, and its detail when the streamer opens it. */
function Entry({ r, first, showState, history, bandit, open, onToggle }: {
  r: Row;
  first: boolean;
  showState: boolean;
  history: History;
  bandit: GambitState['bandit'];
  open: boolean;
  onToggle: () => void;
}) {
  const crowd = r.outcome === 'fired' && !r.contaminated
    ? peopleShort(r.engagement_delta, history.viewers[r.tick])
    : null;

  return (
    <div style={{ borderTop: first ? undefined : '1px solid var(--border)' }}>
      <button onClick={onToggle}
        className="flex w-full items-center gap-3 bg-[var(--bg-surface)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)]">
        <ChevronRight size={11} className="shrink-0 text-[var(--text-muted)]"
          style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
        {showState && (
          <span className="w-12 shrink-0 text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
            {STATE_LABEL[r.state]}
          </span>
        )}
        <span className="w-24 shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
          {ARM_LABEL[r.arm]}
        </span>
        {/* Spans, not divs and paragraphs: the row is a button, and a button may only
            contain phrasing content. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[var(--text-primary)]">
            {r.action?.body ? `“${r.action.body}”` : (
              <span className="italic text-[var(--text-muted)]">{r.outcome}</span>
            )}
          </span>
          {/* Why, not just that: a `Can't tell` with no reason reads as a shrug, and the
              reason is the part that survives questioning. */}
          {whyUnattributable(r) && (
            <span className="block truncate text-[10px] text-[var(--warn)]">
              {whyUnattributable(r)}
            </span>
          )}
        </span>
        {/* A poll's own outcome. Votes are the engagement signal for `chat_poll` — a lift
            number alone hides whether anyone answered. */}
        {Object.values(r.votes).some((n) => n > 0) && (
          <span className="tnum shrink-0 rounded-sm bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
            {Object.entries(r.votes).map(([k, n]) => `${k}:${n}`).join(' · ')}
          </span>
        )}
        {/* Points are the comparable unit; people are the one the streamer feels. Both,
            because they answer different questions. A window that never fired gets neither
            — printing +0.0 pts against it invents a measurement that was never taken. */}
        <span className="w-[104px] shrink-0 text-right">
          {isUnsent(r) ? (
            <span className="text-[11px] text-[var(--text-muted)]">not measured</span>
          ) : (
            <>
              <span className="tnum block text-[15px] font-bold"
                style={{ color: VERDICT_COLOR[labelFor(r)] }}>
                {points(r.engagement_delta)}
              </span>
              {crowd && (
                <span className="tnum block text-[10px] text-[var(--text-muted)]">{crowd}</span>
              )}
            </>
          )}
        </span>
      </button>
      {open && <ResultDetail r={r} h={history} bandit={bandit} />}
    </div>
  );
}

/**
 * Why the unattributable pile is unattributable, counted.
 *
 * A collapsed group still has to answer the question it raises, or collapsing it is just
 * hiding it. The reason strings come from the backend, so this matches on the stable part
 * of each and buckets anything new under a neutral count rather than guessing.
 */
function reasonBreakdown(rows: Row[]): string {
  const buckets = { overlap: 0, control: 0, other: 0 };
  for (const r of rows) {
    const why = whyUnattributable(r) ?? '';
    if (why.includes('another action fired')) buckets.overlap++;
    else if (why.includes('no quiet') || why.includes('nothing to')) buckets.control++;
    else buckets.other++;
  }
  return [
    [buckets.overlap, 'fired too soon after another action'],
    [buckets.control, 'had no comparable quiet window yet'],
    [buckets.other, 'unattributable for another reason'],
  ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}`).join(' · ');
}

/** A collapsible ledger section, headed by a line that reads the same collapsed or open. */
function Group({ dot, title, color, count, note, trailing, open, onToggle, children }: {
  dot: ReactNode;
  title: string;
  color: string;
  count: number;
  note: string;
  /** The group's own total, so the collapsed header is a result and not just a label. */
  trailing?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <button onClick={onToggle}
        className="mb-1.5 flex w-full items-baseline gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-[var(--bg-elevated)]">
        <ChevronRight size={12} className="shrink-0 self-center text-[var(--text-muted)]"
          style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
        {dot}
        <span className="shrink-0 text-[11px] font-bold tracking-[0.2em]" style={{ color }}>
          {title}
        </span>
        <span className="tnum shrink-0 text-[11px] text-[var(--text-muted)]">{count}</span>
        <span className="truncate text-[11px] text-[var(--text-muted)]">— {note}</span>
        {trailing && (
          <span className="tnum ml-auto shrink-0 text-[12px] font-bold" style={{ color }}>
            {trailing}
          </span>
        )}
      </button>
      {open && children}
    </section>
  );
}

/**
 * The best tactic in one chat state by measured average, or undefined while the evidence is
 * too thin to say. Only ever within a state: a spike out-chats a lull no matter what fired
 * in it, so ranking across states would rank the states.
 */
function bestTactic(rows: Row[], state: ChatState) {
  const byArm = new Map<Arm, number[]>();
  for (const r of rows) {
    if (r.state !== state || r.outcome !== 'fired' || r.contaminated || isControl(r)) continue;
    byArm.set(r.arm, [...(byArm.get(r.arm) ?? []), r.engagement_delta]);
  }
  return [...byArm.entries()]
    .filter(([, xs]) => xs.length >= MIN_TRIES)
    .map(([arm, xs]) => ({ arm, mean: xs.reduce((a, n) => a + n, 0) / xs.length, tries: xs.length }))
    .sort((a, b) => b.mean - a.mean)
    .filter((f) => f.mean > 0)[0];
}

/**
 * The empty state, which is a designed surface rather than an apology.
 *
 * Two jobs, and the second is the one that earns the space: say what will appear here, and
 * explain the loop that will fill it. Second zero of a demo is spent on this screen, so
 * "nothing yet" is a wasted first impression — the shape of the thing is interesting even
 * before there is data in it.
 */
function Empty({ icon, kicker, title, blurb, steps }: {
  icon: ReactNode;
  kicker: string;
  title: string;
  blurb: string;
  steps: [string, string][];
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-6">
      <div className="w-full max-w-[520px] rounded-sm border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--kick-green)]">
          {icon}
        </div>
        <div className="mt-3 text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          {kicker}
        </div>
        <h3 className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mx-auto mt-1.5 max-w-[420px] text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {blurb}
        </p>

        <ol className="mt-5 space-y-2 text-left">
          {steps.map(([step, why], i) => (
            <li key={step} className="flex gap-3 rounded-sm bg-[var(--bg-surface)] px-3 py-2">
              <span className="tnum mt-px shrink-0 text-[11px] font-bold text-[var(--kick-green)]">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="text-[12px] font-medium text-[var(--text-primary)]">{step}</span>
                <span className="block text-[11px] leading-snug text-[var(--text-muted)]">{why}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TacticsTab({ s }: { s: GambitState }) {
  const posteriors = s.bandit?.posteriors ?? [];
  if (!posteriors.length) {
    return (
      <Empty
        icon={<FlaskConical size={18} />}
        kicker="NOTHING LEARNED YET"
        title="Three experiments, fifteen cells"
        blurb="Every chat state runs its own experiment, and tactics are only ever compared within one — a spike always out-chats a lull, so ranking across states would measure the state, not the tactic."
        steps={[
          ['3 states × 5 tactics', 'lull, steady and spike, each holding a posterior per tactic'],
          ['Silence is one of the five', 'the “nothing” tactic holds its own posterior, and every intervention pays a cost — quiet has to be beaten on evidence'],
          ['The table appears after the first decision', 'run the gym to fill it in minutes instead of hours'],
        ]}
      />
    );
  }
  return (
    // Cards where there is room, one column where there is not — and keyed to the CONTAINER,
    // not the viewport. That distinction is why this was flattened before: `xl:grid-cols-2`
    // tracks the window, so a wide screen forced two columns into the 30%-wide dashboard
    // panel. `@container` asks the host how much room it actually gave us.
    <div className="@container min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-2">
      {STATES.map((state) => {
        const arms = posteriors.filter((p) => p.state === state)
          .sort((a, b) => b.mean - a.mean);
        const tried = arms.filter((a) => a.pulls > 0);
        const best = tried[0];
        return (
          <section key={state}
            className="flex shrink-0 flex-col rounded-sm border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-secondary)]">
                {STATE_LABEL[state]}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {tried.reduce((n, a) => n + a.pulls, 0)} pulls · {tried.length}/{arms.length} tactics tried
              </span>
            </div>

            <div className="mt-2.5 rounded-sm border px-3 py-2"
              style={{ borderColor: best ? 'var(--kick-green)' : 'var(--border)' }}>
              <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
                LEADING HERE
              </span>
              <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                {best ? best.arm : 'no evidence yet'}
              </div>
              {best && (
                <div className="text-[10px] text-[var(--text-muted)]">
                  posterior mean {best.mean.toFixed(2)} over {best.pulls} pull{best.pulls === 1 ? '' : 's'}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-1.5">
              {arms.map((a, i) => (
                <div key={a.arm} className="flex items-center gap-2">
                  <span className="flex w-28 shrink-0 items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: a.pulls ? ARM_COLORS[i % ARM_COLORS.length] : 'transparent',
                        border: a.pulls ? undefined : '1px solid var(--text-muted)' }} />
                    <span className="truncate text-[12px] text-[var(--text-primary)]">{a.arm}</span>
                  </span>
                  <div className="h-1.5 flex-1 rounded-sm bg-[var(--bg-surface)]">
                    <div className="h-1.5 rounded-sm bg-[var(--kick-green)]"
                      style={{ width: `${a.mean * 100}%` }} />
                  </div>
                  <span className="tnum w-12 shrink-0 text-right text-[12px] font-bold text-[var(--text-primary)]">
                    {a.mean.toFixed(2)}
                  </span>
                  <span className="tnum w-16 shrink-0 text-right text-[10px] text-[var(--text-muted)]">
                    {a.pulls ? `${a.pulls} pulls` : 'untried'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex shrink-0 flex-col rounded-sm border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-secondary)]">
          HOW THE EXPERIMENT RUNS
        </span>
        <div className="mt-3 flex gap-2">
          <div className="flex-1 rounded-sm bg-[var(--bg-surface)] px-3 py-2">
            <div className="tnum text-2xl font-bold text-[var(--kick-green)]">
              {s.bandit?.decisions ?? 0}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">decisions taken</div>
          </div>
          <div className="flex-1 rounded-sm bg-[var(--bg-surface)] px-3 py-2">
            <div className="tnum text-2xl font-bold text-[var(--warn)]">
              {s.results.filter((r) => r.arm === 'nothing').length}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">chose to stay quiet</div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          Each state runs its own experiment. Tactics are only ever compared{' '}
          <span className="text-[var(--text-primary)]">within</span> a state — a spike always
          out-chats a lull, so ranking across states would measure the state, not the tactic.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          <span className="text-[var(--text-secondary)]">nothing</span> is a real arm with its
          own posterior, and every intervention is charged a cost — so silence has to be beaten
          on evidence, not assumed.
        </p>
      </section>
      </div>
    </div>
  );
}

/**
 * A state summary that doubles as the filter control for the ledger below it — and carries
 * the finding for that state, which is the one thing on this page a streamer can act on
 * without reading anything else. It lived in its own band for a while; a row of cards
 * saying "in a lull…" directly under a row of tiles labelled LULL was the same thought
 * printed twice.
 */
function Tile({ k, label, set, all, active, onSelect }: {
  k: Filter;
  label: string;
  set: Row[];
  /** Every result, unfiltered — a finding is computed over the whole session. */
  all: Row[];
  active: boolean;
  onSelect: (k: Filter) => void;
}) {
  const f = set.filter((r) => r.outcome === 'fired');
  const total = f.reduce((a, r) => a + r.engagement_delta, 0);
  const best = k === 'all' ? undefined : bestTactic(all, k);
  const tint = total > NOISE_BAND ? 'var(--kick-green)'
    : total < -NOISE_BAND ? 'var(--danger)' : 'var(--text-secondary)';

  return (
    <button onClick={() => onSelect(k)}
      className="flex-1 rounded-sm border px-3 py-2 text-left transition-colors"
      style={{
        borderColor: active ? 'var(--kick-green)' : 'var(--border)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
      }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="tnum shrink-0 text-[10px] text-[var(--text-muted)]">
          {f.filter((r) => labelFor(r) === 'Worked').length}/{f.length} worked
        </span>
      </div>
      <div className="tnum text-lg font-bold leading-tight" style={{ color: tint }}>
        {points(total)}
      </div>
      <div className="truncate text-[10px] text-[var(--text-muted)]">
        {k === 'all' ? 'every state, summed' : best ? (
          <>
            best: <span className="text-[var(--text-primary)]">{ARM_LABEL[best.arm]}</span>{' '}
            {points(best.mean)} over {best.tries}
          </>
        ) : f.length === 0 ? 'nothing tried here yet' : 'nothing beats silence here yet'}
      </div>
    </button>
  );
}

export default function Review({ s }: { s: GambitState }) {
  const [tab, setTab] = useState<'actions' | 'tactics'>('actions');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const toggle = (k: string, dflt: boolean) =>
    setOpen((o) => ({ ...o, [k]: !(o[k] ?? dflt) }));

  // The whole-session series a row's detail draws its window against.
  const history: History = {
    active: s.activeViewersHistory,
    viewers: s.viewerHistory,
    elapsed: s.historyElapsedS,
  };

  const rows: Row[] = s.results.filter((r) => filter === 'all' || r.state === filter);
  const fired = rows.filter((r) => r.outcome === 'fired');
  const totalLift = fired.reduce((a, r) => a + r.engagement_delta, 0);

  // `tick` is the history array index a result closed under — history is never
  // truncated, so it lines up directly with viewerHistory/activeViewersHistory/actionsHistory.
  const interventions = s.results
    .filter((r) => r.outcome === 'fired')
    .map((r) => ({ index: r.tick, result: r }));

  return (
    // No height, background or padding of its own — the host owns those, so this
    // renders correctly both as a full page and inside a panel.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="tnum text-3xl font-bold leading-none text-[var(--kick-green)]">
          {points(totalLift)}
        </span>
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            more of the audience talking
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {fired.length} interventions · summed matched-control lift, in participation points
            {s.context?.viewer_count ? ` · ${s.context.viewer_count} viewers` : ''}
          </div>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-sm border border-[var(--border)] p-0.5">
          {(['actions', 'tactics'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize ${
                tab === k ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-sm border border-[var(--border)] px-3 py-2">
        <InsightsGraph
          series={[
            { data: s.viewerHistory, color: '#6aa9ff', label: 'Viewers', scaleGroup: 'viewers' },
            { data: s.activeViewersHistory, color: 'var(--kick-green)', label: 'Active Viewers', scaleGroup: 'viewers' },
            { data: s.actionsHistory, color: 'var(--warn)', label: 'Actions' },
          ]}
          interventions={interventions}
          elapsedS={s.historyElapsedS}
          viewers={s.viewerHistory}
        />
      </div>

      {tab === 'tactics' ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col"><TacticsTab s={s} /></div>
      ) : s.results.length === 0 ? (
        // Before the filter tiles, not under them: four tiles of +0.0 pts read as a broken
        // dashboard, where the same emptiness explained reads as a system waiting to run.
        <Empty
          icon={<Radar size={18} />}
          kicker="NO CLOSED WINDOWS YET"
          title="The ledger fills itself"
          blurb="Every decision opens a 60-second window and lands here when it closes — including the decisions to stay quiet, which are the control everything else is measured against."
          steps={[
            ['Watch', 'participation is sampled continuously and classified lull / steady / spike'],
            ['Act, or deliberately not', 'a tactic fires, or the “nothing” tactic wins — either way a window opens'],
            ['Measure against a matched control', 'the lift is against comparable quiet windows, never just before-and-after'],
          ]}
        />
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <Tile k="all" label="EVERYTHING" set={s.results} all={s.results}
              active={filter === 'all'} onSelect={setFilter} />
            {STATES.map((st) => (
              <Tile key={st} k={st} label={STATE_LABEL[st]}
                set={s.results.filter((r) => r.state === st)} all={s.results}
                active={filter === st} onSelect={setFilter} />
            ))}
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {s.results.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)]">
                No closed windows yet. Every decision — including choosing to stay quiet —
                opens a 60s window and lands here when it closes.
              </p>
            )}
            {GROUPS.map(({ verdict, blurb }) => {
              const group = rows
                .filter((r) => !isControl(r) && !isUnsent(r) && labelFor(r) === verdict)
                .sort((a, b) => b.engagement_delta - a.engagement_delta);
              if (!group.length) return null;
              const total = group.reduce((a, r) => a + r.engagement_delta, 0);
              return (
                <Group key={verdict}
                  dot={<span className="h-2 w-2 shrink-0 self-center rounded-sm"
                    style={{ background: VERDICT_COLOR[verdict] }} />}
                  title={verdict.toUpperCase()}
                  color={VERDICT_COLOR[verdict]}
                  count={group.length}
                  // Collapsed, the header is the only thing left saying what is in here.
                  note={verdict === "Can't tell" ? reasonBreakdown(group) : blurb}
                  // Only where a sum means something: an unattributable group's total is a
                  // number nobody should be adding up.
                  trailing={verdict === 'Worked' || verdict === 'Backfired'
                    ? points(total) : undefined}
                  open={isOpen(verdict, false)}
                  onToggle={() => toggle(verdict, false)}
                >
                  <div className="overflow-hidden rounded-sm border border-[var(--border)]">
                    {group.map((r, i) => (
                      <Entry key={r.action_id + i} r={r} first={!i} showState={filter === 'all'}
                        history={history} bandit={s.bandit}
                        open={expanded === r.action_id}
                        onToggle={() => setExpanded(expanded === r.action_id ? null : r.action_id)} />
                    ))}
                  </div>
                </Group>
              );
            })}

            {/* Suggestions that never reached chat. Their own group, not a verdict: an
                expired card carries no information about the tactic at all, and letting a
                pile of them sit under CAN'T TELL buries the windows that were genuinely
                measured-but-unattributable — which are a real and different problem. */}
            {(() => {
              const unsent = rows.filter((r) => !isControl(r) && isUnsent(r));
              if (!unsent.length) return null;
              const expired = unsent.filter((r) => r.outcome === 'dismissed').length;
              return (
                <Group
                  dot={<span className="h-2 w-2 shrink-0 self-center rounded-sm border border-[var(--text-muted)]" />}
                  title="NEVER SENT"
                  color="var(--text-secondary)"
                  count={unsent.length}
                  note={expired === unsent.length
                    ? 'you skipped these, or they expired waiting — nothing went to chat'
                    : `${expired} skipped or expired · ${unsent.length - expired} failed to send`}
                  open={isOpen('unsent', false)}
                  onToggle={() => toggle('unsent', false)}
                >
                  <div className="overflow-hidden rounded-sm border border-dashed border-[var(--border)]">
                    {unsent.map((r, i) => (
                      <Entry key={r.action_id + i} r={r} first={!i} showState={filter === 'all'}
                        history={history} bandit={s.bandit}
                        open={expanded === r.action_id}
                        onToggle={() => setExpanded(expanded === r.action_id ? null : r.action_id)} />
                    ))}
                  </div>
                </Group>
              );
            })()}

            {/* THE CONTROL — quiet windows, scored the same way, no fire cost */}
            {(() => {
              const ctrl = rows.filter(isControl);
              if (!ctrl.length) return null;
              const drift = ctrl.reduce((a, r) => a + r.engagement_delta, 0) / ctrl.length;
              return (
                <Group
                  dot={<span className="h-2 w-2 shrink-0 self-center rounded-sm border border-[var(--text-muted)]" />}
                  title="STAYED QUIET"
                  color="var(--text-muted)"
                  count={ctrl.length}
                  note={`the control every intervention is measured against · chat drifts ${points(drift)} on its own`}
                  open={isOpen('control', false)}
                  onToggle={() => toggle('control', false)}
                >
                  <div className="overflow-hidden rounded-sm border border-dashed border-[var(--border)]">
                    {ctrl.slice(0, 12).map((r, i) => (
                      <div key={r.action_id + i}
                        className="flex items-center gap-3 bg-[var(--bg-surface)] px-3 py-2 opacity-70"
                        style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                        <span className="w-14 shrink-0 text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
                          {STATE_LABEL[r.state]}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-[12px] italic text-[var(--text-muted)]">
                          chose not to intervene
                        </p>
                        <span className="tnum w-[86px] shrink-0 text-right text-[13px] text-[var(--text-secondary)]">
                          {points(r.engagement_delta)}
                        </span>
                      </div>
                    ))}
                    {ctrl.length > 12 && (
                      <p className="bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                        + {ctrl.length - 12} more quiet windows
                      </p>
                    )}
                  </div>
                </Group>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

export { pct };
