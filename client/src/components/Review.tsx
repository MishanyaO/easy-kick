// Review mode — R7 on real data. Rows grouped by verdict, state tiles that summarise and
// filter, and a Tactics tab reading the live bandit posteriors.
import { useState, type ReactNode } from 'react';
import { FlaskConical, Radar } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  STATE_LABEL, VERDICT_COLOR, labelFor, isControl, points, pct, whyUnattributable,
  type ChatState, type VerdictLabel, type ResultFrame, type ActionFrame,
} from '../types';
import Spark from './Spark';

type Row = ResultFrame & { action?: ActionFrame };
type Filter = 'all' | ChatState;

const GROUPS: { verdict: VerdictLabel; blurb: string }[] = [
  { verdict: 'Worked', blurb: 'do more of these' },
  { verdict: 'Neutral', blurb: 'chat did not move' },
  { verdict: 'Backfired', blurb: 'chat got quieter after — avoid these' },
  { verdict: "Can't tell", blurb: 'the window could not be attributed' },
];

const STATES: ChatState[] = ['lull', 'steady', 'spike'];
const ARM_COLORS = ['var(--kick-green)', 'var(--warn)', 'var(--text-secondary)', '#6aa9ff', '#ff7ad9'];

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

/** A state summary that doubles as the filter control for the ledger below it. */
function Tile({ k, label, set, active, onSelect }: {
  k: Filter;
  label: string;
  set: Row[];
  active: boolean;
  onSelect: (k: Filter) => void;
}) {
  const f = set.filter((r) => r.outcome === 'fired');
  return (
    <button onClick={() => onSelect(k)}
      className="flex-1 rounded-sm border px-3 py-2 text-left transition-colors"
      style={{
        borderColor: active ? 'var(--kick-green)' : 'var(--border)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
      }}>
      <div className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-lg font-bold text-[var(--kick-green)]">
          {points(f.reduce((a, r) => a + r.engagement_delta, 0))}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {f.filter((r) => labelFor(r) === 'Worked').length}/{f.length} worked
        </span>
      </div>
    </button>
  );
}

/** One of the live trends: viewers, engagement (msgs/min) and unique engaging viewers. */
function Trend({ label, value, data, color }: {
  label: string; value: string; data: number[]; color: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-sm border border-[var(--border)] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="tnum text-[12px] font-semibold text-[var(--text-primary)]">{value}</span>
      </div>
      <div className="mt-1 opacity-80"><Spark data={data} height={20} color={color} /></div>
    </div>
  );
}

export default function Review({ s }: { s: GambitState }) {
  const [tab, setTab] = useState<'actions' | 'tactics'>('actions');
  const [filter, setFilter] = useState<Filter>('all');

  const rows: Row[] = s.results.filter((r) => filter === 'all' || r.state === filter);
  const fired = rows.filter((r) => r.outcome === 'fired');
  const totalLift = fired.reduce((a, r) => a + r.engagement_delta, 0);

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

      <div className="mt-4 flex gap-2">
        <Trend label="VIEWERS" color="var(--kick-green)"
          value={s.context?.viewer_count != null ? String(s.context.viewer_count) : '—'}
          data={s.viewerSpark} />
        <Trend label="ACTIONS" color="var(--warn)"
          value={s.context ? `${s.context.msgs_per_min.toFixed(1)}/min` : '—'}
          data={s.engagementSpark} />
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
            <Tile k="all" label="EVERYTHING" set={s.results}
              active={filter === 'all'} onSelect={setFilter} />
            {STATES.map((st) => (
              <Tile key={st} k={st} label={STATE_LABEL[st]}
                set={s.results.filter((r) => r.state === st)}
                active={filter === st} onSelect={setFilter} />
            ))}
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {s.results.length === 0 && (
              <p className="text-[12px] text-[var(--text-muted)]">
                No closed windows yet. Every decision — including choosing to stay quiet —
                opens a 60s window and lands here when it closes.
              </p>
            )}
            {GROUPS.map(({ verdict, blurb }) => {
              const group = rows.filter((r) => !isControl(r) && labelFor(r) === verdict)
                .sort((a, b) => b.engagement_delta - a.engagement_delta);
              if (!group.length) return null;
              return (
                <section key={verdict}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR[verdict] }} />
                    <span className="text-[11px] font-bold tracking-[0.2em]"
                      style={{ color: VERDICT_COLOR[verdict] }}>
                      {verdict.toUpperCase()}
                    </span>
                    <span className="tnum text-[11px] text-[var(--text-muted)]">{group.length}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">— {blurb}</span>
                  </div>

                  <div className="overflow-hidden rounded-sm border border-[var(--border)]">
                    {group.map((r, i) => (
                      <div key={r.action_id + i}
                        className="flex items-center gap-3 bg-[var(--bg-surface)] px-3 py-2.5"
                        style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                        {filter === 'all' && (
                          <span className="w-14 shrink-0 text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
                            {STATE_LABEL[r.state]}
                          </span>
                        )}
                        <span className="w-28 shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
                          {r.arm}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-[var(--text-primary)]">
                            {r.action ? `“${r.action.body}”` : (
                              <span className="italic text-[var(--text-muted)]">
                                {r.arm === 'nothing' ? 'stayed quiet' : r.outcome}
                              </span>
                            )}
                          </p>
                          {/* Why, not just that: a `Can't tell` with no reason reads as a
                              shrug, and the reason is the part that survives questioning. */}
                          {whyUnattributable(r) && (
                            <p className="truncate text-[10px] text-[var(--warn)]">
                              {whyUnattributable(r)}
                            </p>
                          )}
                        </div>
                        {/* A poll's own outcome. Votes are the engagement signal for
                            `chat_poll` — a lift number alone hides whether anyone answered. */}
                        {Object.values(r.votes).some((n) => n > 0) && (
                          <span className="tnum shrink-0 rounded-sm bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            {Object.entries(r.votes).map(([k, n]) => `${k}:${n}`).join(' · ')}
                          </span>
                        )}
                        <span className="tnum w-[86px] shrink-0 text-right text-[15px] font-bold"
                          style={{ color: VERDICT_COLOR[labelFor(r)] }}>
                          {points(r.engagement_delta)}
                        </span>
                        <span className="tnum w-[92px] shrink-0 text-right text-[10px] text-[var(--text-muted)]"
                          title="the biased before/after estimator, for comparison">
                          naive {points(r.lift_naive)}
                        </span>
                        <span className="tnum w-[70px] shrink-0 text-right text-[10px] text-[var(--text-muted)]">
                          r={r.reward.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/* THE CONTROL — quiet windows, scored the same way, no fire cost */}
            {(() => {
              const ctrl = rows.filter(isControl);
              if (!ctrl.length) return null;
              const drift = ctrl.reduce((a, r) => a + r.engagement_delta, 0) / ctrl.length;
              return (
                <section>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="h-2 w-2 rounded-sm border border-[var(--text-muted)]" />
                    <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
                      STAYED QUIET
                    </span>
                    <span className="tnum text-[11px] text-[var(--text-muted)]">{ctrl.length}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      — the control every intervention is measured against · mean drift {points(drift)}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-sm border border-dashed border-[var(--border)]">
                    {ctrl.slice(0, 6).map((r, i) => (
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
                        <span className="tnum w-[70px] shrink-0 text-right text-[10px] text-[var(--text-muted)]">
                          r={r.reward.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

export { pct };
