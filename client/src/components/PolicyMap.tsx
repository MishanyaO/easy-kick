// The policy map — everything Gambit has learned, on one screen.
//
// The axis is the whole design, and the first version got it wrong. It plotted the Beta
// posterior mean, which is the expected value of a *reward*: a logistic squash of relative
// lift with the interruption cost already subtracted. That number runs the sampler and it
// answers no question a human has. "0.62" is not a probability of anything.
//
// What the table exists to decide is one comparison — is this tactic better than shutting
// up, in this kind of chat — and that comparison does have an honest unit: P(this arm
// scores above `nothing`), given every window so far. So that is the axis. It is a real
// probability, 50% is a coin flip, and uncertainty is folded into it rather than drawn
// beside it: you cannot reach 90% without evidence, so a line that has climbed IS evidence
// accumulating. Every cell starts at exactly 50% because every belief starts identical, and
// the fan-out from that line is the learning, with nothing left to take on trust.
import { Fragment, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  ARM_BLURB, ARM_LABEL, MIN_PULLS, STATE_LABEL, STATE_PHRASE, SURE, cellKey, pBeats, points,
  type Arm, type Belief, type ChatState, type LastDecision, type Posterior,
} from '../types';

const STATES: ChatState[] = ['lull', 'steady', 'spike'];

/** The cell chart's coordinate space. It is stretched to whatever width the column gets,
 *  so this is a resolution and not a size. */
const CW = 100;
const CH = 30;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const asPct = (p: number) => `${Math.round(p * 100)}%`;

/** Ahead, behind, or too close to call. Printing a direction off 51% would be the chart
 *  claiming a finding out of a coin flip. */
const verdictOf = (p: number) => (p >= SURE ? 'ahead' : p <= 1 - SURE ? 'behind' : 'level');

const TINT = {
  ahead: 'var(--kick-green)',
  behind: 'var(--danger)',
  level: 'var(--text-secondary)',
} as const;

/**
 * How sure Gambit is that this tactic beats staying quiet, at every point in the session.
 *
 * Both trails are appended on every bandit frame, so they are index-aligned by
 * construction; `Math.min` is only insurance against a frame that arrived mid-render.
 */
function trace(mine: Belief[], control: Belief[], now: number): number[] {
  const n = Math.min(mine.length, control.length);
  // One sample is a dot, not a line. Two of the current value draws the flat segment that
  // is the honest picture anyway: this belief has not moved for as long as we have watched.
  if (n < 2) return [now, now];
  return Array.from({ length: n }, (_, i) => pBeats(mine[i], control[i]));
}

/** What the ledger measured for this cell, as opposed to what the bandit believes about it.
 *  Different questions and different units — the posterior is a squashed score the sampler
 *  runs on, the lift is participation points — so the map shows the belief and the readout
 *  shows the measurement. `nothing` windows close as `skipped`; they never fired. */
function measured(results: GambitState['results'], state: ChatState, arm: Arm) {
  const want = arm === 'nothing' ? 'skipped' : 'fired';
  const xs = results
    .filter((r) => r.state === state && r.arm === arm && r.outcome === want && !r.contaminated)
    .map((r) => r.engagement_delta);
  if (!xs.length) return null;
  return { mean: xs.reduce((a, n) => a + n, 0) / xs.length, n: xs.length };
}

/** One belief's confidence over the session, against the 50% coin flip. */
function Cell({ p, series, hot, onHover }: {
  p: Posterior;
  series: number[];
  hot: boolean;
  onHover: (on: boolean) => void;
}) {
  const now = series[series.length - 1];
  const cold = p.pulls < MIN_PULLS;
  const tint = cold ? 'var(--text-muted)' : TINT[verdictOf(now)];
  const x = (i: number) => (i / (series.length - 1)) * CW;
  const y = (v: number) => CH - clamp01(v) * CH;
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="cursor-default rounded-sm border px-1.5 pb-1 pt-1.5 transition-colors"
      style={{
        borderColor: hot ? tint : 'var(--border)',
        background: hot ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        opacity: p.pulls === 0 ? 0.5 : 1,
      }}
    >
      <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: CH }}>
        {/* the coin flip — where every belief starts and where "no idea" stays */}
        <line x1={0} x2={CW} y1={y(0.5)} y2={y(0.5)} stroke="var(--text-secondary)"
          strokeWidth="1" strokeDasharray="2,2" opacity={0.55}
          vectorEffect="non-scaling-stroke" />
        {/* the area between the trace and the coin flip: which side, and by how much */}
        <path d={`${d}L${CW},${y(0.5)}L0,${y(0.5)}Z`} fill={tint} opacity={hot ? 0.24 : 0.14} />
        <path d={d} fill="none" stroke={tint} strokeWidth={hot ? 2 : 1.5}
          vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="mt-1 flex items-baseline gap-1">
        {p.pulls === 0 ? (
          <span className="text-[10px] text-[var(--text-muted)]">untried</span>
        ) : (
          <>
            <span className="tnum text-[11px] font-bold leading-none" style={{ color: tint }}>
              {asPct(now)}
            </span>
            <span className="tnum text-[9px] leading-none text-[var(--text-muted)]">
              ×{p.pulls}
            </span>
            {cold && (
              <span className="ml-auto text-[9px] leading-none text-[var(--warn)]"
                title={`Under ${MIN_PULLS} tries the sampler ignores this cell and draws the flat prior instead`}>
                thin
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The answer, before the evidence for it.
 *
 * The map is the argument; this is the conclusion, and a streamer mid-stream wants the
 * conclusion. One card per chat state, naming the tactic to reach for and how sure Gambit
 * is — or saying plainly that it does not know yet, which is a real answer and the one the
 * old tactics tab could not give: it always crowned a leader, even off a single window.
 */
function Verdict({ state, best, tried, of }: {
  state: ChatState;
  best: { arm: Arm; p: number; pulls: number; lift: { mean: number; n: number } | null } | null;
  tried: number;
  of: number;
}) {
  return (
    <div className="min-w-[150px] flex-1 rounded-sm border px-3 py-2"
      style={{ borderColor: best ? 'var(--kick-green)' : 'var(--border)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          {STATE_LABEL[state]}
        </span>
        <span className="tnum shrink-0 text-[9px] text-[var(--text-muted)]">
          {tried}/{of} tried
        </span>
      </div>
      {best ? (
        <>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-[var(--text-primary)]">
            {ARM_LABEL[best.arm]}
          </div>
          <div className="text-[11px] leading-snug text-[var(--kick-green)]">
            {asPct(best.p)} sure it beats staying quiet
          </div>
          <div className="tnum truncate text-[10px] text-[var(--text-muted)]">
            {best.lift
              ? `${points(best.lift.mean)} on average over ${best.lift.n}`
              : `${best.pulls} tries, no clean measurement yet`}
          </div>
        </>
      ) : (
        <>
          <div className="mt-0.5 text-[15px] font-semibold text-[var(--text-secondary)]">
            Still finding out
          </div>
          <div className="text-[11px] leading-snug text-[var(--text-muted)]">
            {tried === 0
              ? 'nothing tried here yet'
              : 'nothing is clearly ahead of staying quiet here'}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The last Thompson draw, spelled out.
 *
 * The single most explainable three seconds of the whole system, and it was never on
 * screen: it does not pick the arm with the best average, it rolls one number out of each
 * belief and plays the highest. Wide beliefs roll wild, which is how a thing that only ever
 * played its favourite would never find out it was wrong.
 */
function LastCall({ d }: { d: LastDecision }) {
  const drawn = (Object.entries(d.samples) as [Arm, number][]).sort((a, b) => b[1] - a[1]);
  if (!drawn.length) return null;

  return (
    <section className="rounded-sm border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          THE LAST CALL
        </span>
        <span className="truncate text-[11px] text-[var(--text-secondary)]">
          {STATE_PHRASE[d.state]} — one number rolled out of each belief
        </span>
      </div>

      <div className="mt-2.5 space-y-1">
        {drawn.map(([arm, v]) => {
          // A forced control was not won, so the top roll is still shown as the roll that
          // would have played. Marking it PLAYED anyway would be the graph telling a tidier
          // story than the policy actually followed.
          const chosen = arm === d.chosen;
          const won = chosen && !d.forced_control;
          const accent = won ? 'var(--kick-green)'
            : chosen ? 'var(--text-secondary)' : 'var(--text-muted)';
          return (
            <div key={arm} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px]"
                style={{ color: chosen ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {ARM_LABEL[arm]}
              </span>
              <span className="h-1.5 flex-1 rounded-sm bg-[var(--bg-elevated)]">
                <span className="block h-1.5 rounded-sm"
                  style={{ width: `${clamp01(v) * 100}%`, background: accent }} />
              </span>
              <span className="tnum w-8 shrink-0 text-right text-[10px] text-[var(--text-secondary)]">
                {v.toFixed(2)}
              </span>
              {/* Fixed width whether or not it holds a word, so the bars keep one right edge. */}
              <span className="w-14 shrink-0 text-[9px] font-bold tracking-widest"
                style={{ color: accent }}>
                {won ? 'PLAYED' : chosen ? 'HELD' : ''}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]">
        {d.forced_control ? (
          <>
            The highest roll was <span className="text-[var(--text-secondary)]">
              {ARM_LABEL[drawn[0][0]]}</span>, but this window was
            <span className="text-[var(--text-primary)]"> held back on purpose</span> — a
            share of every session is reserved as quiet windows, or there is nothing left to
            measure the loud ones against.
          </>
        ) : (
          <>
            Highest roll plays. A belief that is still wide throws wild numbers and gets its
            turn anyway — that is the exploring, and it is why the map above is not just the
            same tactic over and over.
          </>
        )}
      </p>
    </section>
  );
}

/** The empty state, which is a designed surface rather than an apology — the first seconds
 *  of a demo are spent on it, and the shape of the experiment is interesting before there
 *  is anything in it. */
function Empty({ cells }: { cells: number }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-6">
      <div className="w-full max-w-[520px] rounded-sm border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--kick-green)]">
          <FlaskConical size={18} />
        </div>
        <div className="mt-3 text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
          NOTHING LEARNED YET
        </div>
        <h3 className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">
          Three kinds of chat, {cells} questions
        </h3>
        <p className="mx-auto mt-1.5 max-w-[420px] text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Every chat state runs its own experiment, and tactics are only ever compared within
          one — a spike out-chats a lull no matter what fired in it, so ranking across states
          would be measuring the state.
        </p>
        <ol className="mt-5 space-y-2 text-left">
          {([
            ['Each cell asks one question',
              'does this tactic beat staying quiet, in this kind of chat — and the answer is a probability, not a score'],
            ['Staying quiet is the thing to beat',
              'it holds its own belief and every interruption is charged a cost, so silence has to be beaten on evidence'],
            ['Every answer starts at a coin flip',
              'run the gym and watch them separate in minutes instead of over a season'],
          ] as [string, string][]).map(([step, why], i) => (
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

export default function PolicyMap({ s }: { s: GambitState }) {
  // A reserved line under the grid rather than a tooltip over it. Same reason as the
  // insights chart: a popup that covers the thing it describes makes you move the mouse
  // away to read about where the mouse was.
  const [hot, setHot] = useState<string | null>(null);

  const posteriors = s.bandit?.posteriors ?? [];
  const at = (state: ChatState, arm: Arm) =>
    posteriors.find((p) => p.state === state && p.arm === arm);
  // Rows come from the table, never from a list here: the backend explores four of the six
  // arms — prediction stakes viewers' points, the digest is streamer-only — and a hardcoded
  // list would invent cells the sampler never considers. `nothing` is not a row; it is the
  // 50% line every other row is drawn against.
  const arms = [...new Set(posteriors.map((p) => p.arm))].filter((a) => a !== 'nothing').sort();

  if (!posteriors.length || !arms.length) return <Empty cells={3 * 3} />;

  const trail = (state: ChatState, arm: Arm) => s.banditTrail[cellKey(state, arm)] ?? [];
  /** The confidence trace for one cell, and the number it stands at now. */
  const seriesFor = (state: ChatState, arm: Arm): number[] => {
    const mine = at(state, arm);
    const ctrl = at(state, 'nothing');
    if (!mine || !ctrl) return [0.5, 0.5];
    return trace(trail(state, arm), trail(state, 'nothing'), pBeats(mine, ctrl));
  };

  /** The tactic to reach for in one state, or null while nothing is clearly ahead. Only
   *  ever within a state, and only once a cell holds enough windows for the sampler itself
   *  to be acting on it. */
  const leaderIn = (state: ChatState) => {
    const ctrl = at(state, 'nothing');
    if (!ctrl) return null;
    const ranked = arms
      .map((arm) => ({ arm, p: pBeats(at(state, arm)!, ctrl), pulls: at(state, arm)!.pulls }))
      .filter((c) => c.pulls >= MIN_PULLS && c.p >= SURE)
      .sort((a, b) => b.p - a.p);
    const top = ranked[0];
    return top ? { ...top, lift: measured(s.results, state, top.arm) } : null;
  };

  const cells = STATES.length * arms.length;
  const tried = STATES.flatMap((st) => arms.map((a) => at(st, a)))
    .filter((p) => p && p.pulls > 0).length;

  // The hovered cell, read back in words. Everything here comes off frames already on
  // screen, so it degrades to the idle line rather than inventing a reading.
  const detail = (() => {
    if (!hot) return null;
    const [state, arm] = hot.split('|') as [ChatState, Arm];
    const p = at(state, arm);
    if (!p) return null;
    const series = seriesFor(state, arm);
    const now = series[series.length - 1];
    const m = measured(s.results, state, arm);
    // An untried cell does not sit at 50% forever: the control keeps gaining evidence
    // underneath it, so an unknown tactic slides as silence proves itself. That is the
    // honest reading, and it is why this line does not promise a coin flip.
    const body = p.pulls === 0
      ? `never tried while ${STATE_PHRASE[state]} — no evidence here at all, which is exactly why this one will get picked`
      : p.pulls < MIN_PULLS
        ? `${p.pulls} ${p.pulls === 1 ? 'try' : 'tries'} — under ${MIN_PULLS} Gambit keeps treating this as unknown rather than backing a number off one window`
        : [
          `${asPct(now)} sure it beats staying quiet`,
          `${p.pulls} tries`,
          m ? `measured ${points(m.mean)} on average over ${m.n}` : null,
        ].filter(Boolean).join(' · ');
    return { arm, state, body };
  })();

  return (
    <div className="@container min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
            WHAT TO REACH FOR
          </span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            the call Gambit would make right now, per kind of chat
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATES.map((st) => (
            <Verdict key={st} state={st} best={leaderIn(st)} of={arms.length}
              tried={arms.filter((a) => (at(st, a)?.pulls ?? 0) > 0).length} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">
            HOW IT GOT THERE
          </span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            each line is <span className="text-[var(--text-primary)]">how sure</span> Gambit
            is that the tactic beats staying quiet — the dashes are 50%, a coin flip
          </span>
        </div>

        {/* One grid, so the arm labels and the three state columns stay locked together.
            Three columns always: they are the axis, not a responsive layout. */}
        <div className="grid gap-1.5"
          style={{ gridTemplateColumns: 'minmax(64px, 92px) repeat(3, minmax(0, 1fr))' }}>
          <span />
          {STATES.map((st) => (
            <div key={st} className="pb-0.5 text-center">
              <div className="text-[10px] font-bold tracking-[0.16em] text-[var(--text-secondary)]">
                {STATE_LABEL[st]}
              </div>
              <div className="tnum text-[9px] text-[var(--text-muted)]">
                {posteriors.filter((p) => p.state === st).reduce((n, p) => n + p.pulls, 0)} windows
              </div>
            </div>
          ))}

          {arms.map((arm) => (
            <Fragment key={arm}>
              <div className="flex min-w-0 items-center pr-1">
                <span className="truncate text-[12px] text-[var(--text-primary)]"
                  title={ARM_BLURB[arm]}>
                  {ARM_LABEL[arm]}
                </span>
              </div>
              {STATES.map((st) => {
                const p = at(st, arm);
                if (!p) return <div key={st} />;
                return (
                  <Cell key={st} p={p} series={seriesFor(st, arm)}
                    hot={hot === cellKey(st, arm)}
                    onHover={(on) => setHot(on ? cellKey(st, arm) : null)} />
                );
              })}
            </Fragment>
          ))}
        </div>

        <div className="mt-2 flex h-[30px] items-center gap-2 overflow-hidden rounded-sm px-2 text-[11px] transition-colors"
          style={{
            background: detail ? 'var(--bg-elevated)' : 'transparent',
            borderLeft: `2px solid ${detail ? 'var(--kick-green)' : 'transparent'}`,
          }}>
          {detail ? (
            <>
              <span className="shrink-0 font-semibold text-[var(--text-primary)]">
                {ARM_LABEL[detail.arm]}
              </span>
              <span className="shrink-0 text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
                {STATE_LABEL[detail.state]}
              </span>
              <span className="truncate text-[var(--text-secondary)]">{detail.body}</span>
            </>
          ) : (
            <span className="text-[var(--text-muted)]">
              {s.bandit?.decisions ?? 0} decisions so far — hover a cell to read one
            </span>
          )}
        </div>
      </section>

      {s.bandit?.last_decision && <LastCall d={s.bandit.last_decision} />}

      <p className="pb-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {cells - tried > 0 ? (
          <>
            <span className="text-[var(--text-secondary)]">{cells - tried} of {cells}</span>{' '}
            questions have not been asked yet, and the answered ones are one stream deep.
          </>
        ) : (
          <>All {cells} questions have an answer now, one stream deep.</>
        )}{' '}
        This table — {posteriors.length} beliefs, no chat log, nothing tied to tonight — is
        the whole of what Gambit knows, which is what makes it the thing that carries into
        the next stream instead of starting cold.
      </p>
    </div>
  );
}
