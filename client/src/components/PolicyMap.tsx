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
//
// It was drawn as a 3×3 matrix for a while, which put a *row* axis on the screen — read
// across and you are comparing one tactic between a lull and a spike. That comparison is
// exactly the one this design says is meaningless, and the grid was inviting it. One card
// per state instead: a state is an experiment, the card is its result and its workings, and
// nothing on the page suggests reading between them.
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  ARM_BLURB, ARM_LABEL, MIN_PULLS, STATE_LABEL, STATE_PHRASE, SURE, cellKey, pBeats, points,
  type Arm, type Belief, type ChatState, type LastDecision, type Posterior,
} from '../types';

const STATES: ChatState[] = ['lull', 'steady', 'spike'];

/** A track's coordinate space. It is stretched to whatever width the card gives it, so this
 *  is a resolution and not a size. */
const CW = 100;
const CH = 20;

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

/** The cell read back in a sentence, for the track's tooltip. Progressive detail only —
 *  every number in it is already printed on the row. */
function reading(p: Posterior, now: number, state: ChatState, arm: Arm): string {
  // An untried cell does not sit at 50% forever: the control keeps gaining evidence
  // underneath it, so an unknown tactic slides as silence proves itself. That is the honest
  // reading, and it is why this line does not promise a coin flip.
  if (p.pulls === 0) {
    return `${ARM_LABEL[arm]} — never tried while ${STATE_PHRASE[state]}, which is exactly why it will get picked. ${ARM_BLURB[arm]}.`;
  }
  if (p.pulls < MIN_PULLS) {
    return `${ARM_LABEL[arm]} — ${p.pulls} ${p.pulls === 1 ? 'try' : 'tries'}. Under ${MIN_PULLS} Gambit keeps treating this as unknown rather than backing a number off one window.`;
  }
  return `${ARM_LABEL[arm]} — ${asPct(now)} sure it beats staying quiet, over ${p.pulls} tries. ${ARM_BLURB[arm]}.`;
}

/** One tactic's line inside a state card: how sure, and how much it has to go on. */
function Track({ state, arm, p, series }: {
  state: ChatState;
  arm: Arm;
  p: Posterior;
  series: number[];
}) {
  const now = series[series.length - 1];
  const cold = p.pulls < MIN_PULLS;
  // Grey, not green or red: under MIN_PULLS the sampler ignores this cell, so colouring it
  // by direction would be the chart calling a race the policy is not running. Secondary
  // rather than muted, though — early in a session every cell is cold, and a grid of lines
  // too faint to see is a screen that looks broken rather than one that looks undecided.
  const tint = cold ? 'var(--text-secondary)' : TINT[verdictOf(now)];
  const x = (i: number) => (i / (series.length - 1)) * CW;
  const y = (v: number) => CH - clamp01(v) * CH;
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  return (
    <div className="flex items-center gap-2" title={reading(p, now, state, arm)}
      style={{ opacity: p.pulls === 0 ? 0.6 : 1 }}>
      <span className="w-[88px] shrink-0 truncate text-body text-[var(--text-primary)]">
        {ARM_LABEL[arm]}
      </span>
      <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none"
        className="min-w-0 flex-1" style={{ display: 'block', height: CH }}>
        {/* the coin flip — where every belief starts and where "no idea" stays */}
        <line x1={0} x2={CW} y1={y(0.5)} y2={y(0.5)} stroke="var(--text-muted)" strokeWidth="1"
          strokeDasharray="2,2" opacity={0.8} vectorEffect="non-scaling-stroke" />
        {/* the area between the trace and the coin flip: which side, and by how much */}
        <path d={`${d}L${CW},${y(0.5)}L0,${y(0.5)}Z`} fill={tint} opacity={0.18} />
        <path d={d} fill="none" stroke={tint} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="tnum w-9 shrink-0 text-right text-body font-bold" style={{ color: tint }}>
        {p.pulls === 0 ? '—' : asPct(now)}
      </span>
      <span className="tnum w-7 shrink-0 text-right text-label text-[var(--text-muted)]">
        {p.pulls === 0 ? 'new' : `×${p.pulls}`}
      </span>
    </div>
  );
}

/** What Gambit would do in one state right now. Three answers, and "staying quiet wins" is
 *  a real one — the old map could only phrase it as an absence ("nothing is clearly ahead"),
 *  which buries the single most interesting finding a session produces. */
type Call =
  | { kind: 'arm'; arm: Arm; p: number; lift: { mean: number; n: number } | null }
  | { kind: 'quiet'; p: number }
  | { kind: 'unknown'; tried: number; of: number };

/**
 * One chat state: the call, then the workings behind it.
 *
 * A state is a self-contained experiment, so it gets a self-contained card. The conclusion
 * sits at the top because a streamer mid-stream wants the conclusion; the three traces sit
 * under it because a judge wants to see it was earned.
 */
function StateCard({ state, call, windows, children }: {
  state: ChatState;
  call: Call;
  windows: number;
  children: React.ReactNode;
}) {
  const edge = call.kind === 'arm' ? 'var(--kick-green)'
    : call.kind === 'quiet' ? 'var(--text-secondary)' : 'var(--border)';

  const headline = call.kind === 'arm' ? ARM_LABEL[call.arm]
    : call.kind === 'quiet' ? 'Stay quiet' : 'Still finding out';

  const sub = call.kind === 'arm'
    ? `${asPct(call.p)} sure it beats staying quiet`
    : call.kind === 'quiet'
      ? `${asPct(call.p)} sure silence is the better move here`
      : call.tried === 0 ? 'nothing tried here yet' : 'nothing has separated from the coin flip';

  const meta = call.kind === 'arm'
    ? (call.lift
      ? `${points(call.lift.mean)} on average over ${call.lift.n}`
      : 'no clean measurement yet')
    : call.kind === 'quiet' ? 'every tactic tried here has come out behind'
      // What it is waiting for, not just that it is waiting. "2 tried so far" leaves a
      // reader to guess whether the thing is stuck.
      : `${call.tried}/${call.of} tactics tried · ${MIN_PULLS} windows each to call it`;

  return (
    <section className="flex min-w-[248px] flex-1 flex-col rounded-sm border bg-[var(--bg-surface)]"
      style={{ borderColor: edge, borderLeftWidth: 3 }}>
      <header className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
        <span className="text-body font-bold tracking-[0.18em] text-[var(--text-secondary)]">
          {STATE_LABEL[state]}
        </span>
        <span className="tnum shrink-0 text-label text-[var(--text-muted)]">
          {windows} windows
        </span>
      </header>

      <div className="px-3 pb-3 pt-1">
        <div className="truncate text-stat font-semibold leading-tight"
          style={{ color: call.kind === 'unknown' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
          {headline}
        </div>
        <div className="text-body leading-snug"
          style={{ color: call.kind === 'arm' ? 'var(--kick-green)' : 'var(--text-secondary)' }}>
          {sub}
        </div>
        <div className="tnum truncate text-body text-[var(--text-muted)]">{meta}</div>
      </div>

      <div className="space-y-1.5 border-t border-[var(--border)] px-3 py-2.5">{children}</div>
    </section>
  );
}

/**
 * The last Thompson draw, spelled out.
 *
 * It answers the question the cards above raise and cannot answer: if Poll is ahead in a
 * lull, why did it just play a Quiz? Because the policy does not pick the best average — it
 * rolls one number out of each belief and plays the highest, and a belief that is still
 * wide rolls wild. That is the exploring, it is why the cards fan out instead of repeating
 * one tactic forever, and it is invisible in a table of results.
 *
 * Titled for the question rather than for the mechanism: "THE LAST CALL" described what the
 * box contained and never said why anyone should look at it.
 */
function LastCall({ d }: { d: LastDecision }) {
  const drawn = (Object.entries(d.samples) as [Arm, number][]).sort((a, b) => b[1] - a[1]);
  if (!drawn.length) return null;

  return (
    <section className="rounded-sm border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 text-label font-bold tracking-[0.2em] text-[var(--text-muted)]">
          WHY IT PICKED THAT
        </span>
        <span className="text-body text-[var(--text-secondary)]">
          {STATE_PHRASE[d.state]}, so it rolled one number out of each belief. Highest plays.
        </span>
      </div>

      {/* Capped: a 0.98 roll drawn as a metre of solid green across a wide screen reads as
          a progress bar, not as one draw out of four. */}
      <div className="mt-2.5 max-w-[680px] space-y-1.5">
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
              <span className="w-[92px] shrink-0 truncate text-body"
                style={{ color: chosen ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {ARM_LABEL[arm]}
              </span>
              <span className="h-2 flex-1 rounded-sm bg-[var(--bg-elevated)]">
                <span className="block h-2 rounded-sm"
                  style={{ width: `${clamp01(v) * 100}%`, background: accent }} />
              </span>
              <span className="tnum w-9 shrink-0 text-right text-body text-[var(--text-secondary)]">
                {v.toFixed(2)}
              </span>
              {/* Fixed width whether or not it holds a word, so the bars keep one right edge. */}
              <span className="w-[52px] shrink-0 text-label font-bold tracking-widest"
                style={{ color: accent }}>
                {won ? 'PLAYED' : chosen ? 'HELD' : ''}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-body leading-snug text-[var(--text-muted)]">
        {d.forced_control
          ? 'This window was held back on purpose — a share of every session is reserved as quiet windows, or there is nothing to measure the loud ones against.'
          : 'A belief that is still wide throws wild numbers and gets its turn anyway. That is the exploring.'}
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
      <div className="w-full max-w-[560px] rounded-sm border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--kick-green)]">
          <FlaskConical size={18} />
        </div>
        <div className="mt-3 text-label font-bold tracking-[0.2em] text-[var(--text-muted)]">
          NOTHING LEARNED YET
        </div>
        <h3 className="mt-1 text-stat font-semibold text-[var(--text-primary)]">
          Three kinds of chat, {cells} questions
        </h3>
        <p className="mx-auto mt-2 max-w-[440px] text-body leading-relaxed text-[var(--text-secondary)]">
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
              'start the simulator and watch them separate in minutes instead of over a season'],
          ] as [string, string][]).map(([step, why], i) => (
            <li key={step} className="flex gap-3 rounded-sm bg-[var(--bg-surface)] px-3 py-2.5">
              <span className="tnum mt-px shrink-0 text-body font-bold text-[var(--kick-green)]">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="text-body font-medium text-[var(--text-primary)]">{step}</span>
                <span className="block text-body leading-snug text-[var(--text-muted)]">{why}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function PolicyMap({ s }: { s: GambitState }) {
  const [why, setWhy] = useState(false);

  const posteriors = s.bandit?.posteriors ?? [];
  const at = (state: ChatState, arm: Arm) =>
    posteriors.find((p) => p.state === state && p.arm === arm);
  // Rows come from the table, never from a list here: the backend explores three tactics
  // plus silence, and a hardcoded list would invent cells the sampler never considers.
  // `nothing` is not a row; it is the 50% line every other row is drawn against.
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

  /** What Gambit would do in one state, only counting cells the sampler itself is acting on.
   *  Under `MIN_PULLS` a cell is treated as unknown, so it can neither win nor lose here. */
  const callFor = (state: ChatState): Call => {
    const ctrl = at(state, 'nothing');
    const tried = arms.filter((a) => (at(state, a)?.pulls ?? 0) > 0).length;
    if (!ctrl) return { kind: 'unknown', tried, of: arms.length };
    const ranked = arms
      .map((arm) => ({ arm, p: pBeats(at(state, arm)!, ctrl), pulls: at(state, arm)!.pulls }))
      .filter((c) => c.pulls >= MIN_PULLS)
      .sort((a, b) => b.p - a.p);
    if (!ranked.length) return { kind: 'unknown', tried, of: arms.length };
    const top = ranked[0];
    if (top.p >= SURE) {
      return { kind: 'arm', arm: top.arm, p: top.p, lift: measured(s.results, state, top.arm) };
    }
    // Even the best tactic here is behind silence by a margin we would call the other way.
    if (top.p <= 1 - SURE) return { kind: 'quiet', p: 1 - top.p };
    return { kind: 'unknown', tried, of: arms.length };
  };

  const cells = STATES.length * arms.length;
  const tried = STATES.flatMap((st) => arms.map((a) => at(st, a)))
    .filter((p) => p && p.pulls > 0).length;

  return (
    <div className="@container min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-label font-bold tracking-[0.2em] text-[var(--text-muted)]">
          WHAT GAMBIT KNOWS
        </span>
        <span className="text-body text-[var(--text-secondary)]">
          {arms.length} tactics × {STATES.length} kinds of chat ={' '}
          <span className="tnum text-[var(--text-primary)]">{cells} questions</span>
          {cells - tried > 0 ? `, ${cells - tried} still unasked` : ', all asked'} ·{' '}
          <span className="tnum">{s.bandit?.decisions ?? 0}</span> decisions
        </span>
        <button onClick={() => setWhy((v) => !v)}
          className="ml-auto shrink-0 text-body text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          {why ? 'hide' : 'why only these tactics?'}
        </button>
      </div>

      {/* The question every judge asks within ten seconds of seeing a 3×3, answered in one
          line and folded away again. */}
      {why && (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-body leading-relaxed text-[var(--text-secondary)]">
          Gambit knows six moves; only these three are experiments. Chat digest is written
          for the streamer and never posted, so chat cannot react to it, and Prediction
          stakes viewers&rsquo; own points — neither can be scored as a lift in participation,
          so neither goes through the bandit. The fourth arm is staying quiet, and it is the
          50% line each of these is drawn against rather than a row of its own.
        </p>
      )}

      {/* One card per state, and deliberately no way to read across them: comparing a tactic
          between a lull and a spike compares the lull and the spike. */}
      <div className="flex flex-wrap gap-2">
        {STATES.map((st) => (
          <StateCard key={st} state={st} call={callFor(st)}
            windows={posteriors.filter((p) => p.state === st).reduce((n, p) => n + p.pulls, 0)}>
            {arms.map((arm) => {
              const p = at(st, arm);
              return p && <Track key={arm} state={st} arm={arm} p={p} series={seriesFor(st, arm)} />;
            })}
          </StateCard>
        ))}
      </div>

      <p className="text-body leading-snug text-[var(--text-muted)]">
        Each line is <span className="text-[var(--text-primary)]">how sure</span> Gambit is
        that the tactic beats staying quiet; the dashes are 50%, a coin flip. This table —{' '}
        {posteriors.length} beliefs, no chat log, nothing tied to tonight — is the whole of
        what it knows, which is what makes it the thing that carries into the next stream
        instead of starting cold.
      </p>

      {s.bandit?.last_decision && <LastCall d={s.bandit.last_decision} />}
    </div>
  );
}
