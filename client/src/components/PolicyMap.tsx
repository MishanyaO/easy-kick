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
import { useState } from "react"
import { ChevronDown, FlaskConical } from "lucide-react"
import type { GambitState } from "../useGambit"
import {
  ARM_BLURB,
  ARM_LABEL,
  MIN_PULLS,
  STATE_LABEL,
  STATE_PHRASE,
  SURE,
  betaLogPdf,
  betaSd,
  cellKey,
  pBeats,
  points,
  type Arm,
  type Belief,
  type ChatState,
  type Posterior,
} from "../types"

const STATES: ChatState[] = ["lull", "steady", "spike"]

/** A track's coordinate space. It is stretched to whatever width the card gives it, so this
 *  is a resolution and not a size. */
const CW = 100
const CH = 20

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const asPct = (p: number) => `${Math.round(p * 100)}%`

/** Ahead, behind, or too close to call. Printing a direction off 51% would be the chart
 *  claiming a finding out of a coin flip. */
const verdictOf = (p: number) =>
  p >= SURE ? "ahead" : p <= 1 - SURE ? "behind" : "level"

const TINT = {
  ahead: "var(--kick-green)",
  behind: "var(--danger)",
  level: "var(--text-secondary)",
} as const

/**
 * How sure Gambit is that this tactic beats staying quiet, at every point in the session.
 *
 * Both trails are appended on every bandit frame, so they are index-aligned by
 * construction; `Math.min` is only insurance against a frame that arrived mid-render.
 */
function trace(mine: Belief[], control: Belief[], now: number): number[] {
  const n = Math.min(mine.length, control.length)
  // One sample is a dot, not a line. Two of the current value draws the flat segment that
  // is the honest picture anyway: this belief has not moved for as long as we have watched.
  if (n < 2) return [now, now]
  return Array.from({ length: n }, (_, i) => pBeats(mine[i], control[i]))
}

/** What the ledger measured for this cell, as opposed to what the bandit believes about it.
 *  Different questions and different units — the posterior is a squashed score the sampler
 *  runs on, the lift is participation points — so the map shows the belief and the readout
 *  shows the measurement. `nothing` windows close as `skipped`; they never fired. */
function measured(results: GambitState["results"], state: ChatState, arm: Arm) {
  const want = arm === "nothing" ? "skipped" : "fired"
  const xs = results
    .filter(
      (r) =>
        r.state === state &&
        r.arm === arm &&
        r.outcome === want &&
        !r.contaminated,
    )
    .map((r) => r.engagement_delta)
  if (!xs.length) return null
  return { mean: xs.reduce((a, n) => a + n, 0) / xs.length, n: xs.length }
}

/** The cell read back in a sentence, for the track's tooltip. Progressive detail only —
 *  every number in it is already printed on the row. */
function reading(
  p: Posterior,
  now: number,
  state: ChatState,
  arm: Arm,
): string {
  // An untried cell does not sit at 50% forever: the control keeps gaining evidence
  // underneath it, so an unknown tactic slides as silence proves itself. That is the honest
  // reading, and it is why this line does not promise a coin flip.
  if (p.pulls === 0) {
    return `${ARM_LABEL[arm]} — never tried while ${STATE_PHRASE[state]}, which is exactly why it will get picked. ${ARM_BLURB[arm]}.`
  }
  if (p.pulls < MIN_PULLS) {
    return `${ARM_LABEL[arm]} — ${p.pulls} ${p.pulls === 1 ? "try" : "tries"}. Under ${MIN_PULLS} Gambit keeps treating this as unknown rather than backing a number off one window.`
  }
  return `${ARM_LABEL[arm]} — ${asPct(now)} sure it beats staying quiet, over ${p.pulls} tries. ${ARM_BLURB[arm]}.`
}

/** The density panel's coordinate space — a resolution, not a size, same as a track's. */
const DW = 200
const DH = 64
const DSAMPLES = 96

const beliefMean = (b: Belief) => b.alpha / (b.alpha + b.beta)
const beliefSd = (b: Belief) => betaSd(b.alpha, b.beta)

/** Beta(α, β) sampled across [lo, hi]. */
const density = (b: Belief, lo: number, hi: number): number[] =>
  Array.from({ length: DSAMPLES }, (_, i) => {
    const x = clamp01(lo + ((hi - lo) * i) / (DSAMPLES - 1))
    return Math.exp(
      betaLogPdf(Math.min(1 - 1e-9, Math.max(1e-9, x)), b.alpha, b.beta),
    )
  })

/**
 * The two beliefs themselves, drawn.
 *
 * The line above this is a derived number; this is the thing the number is derived *from* —
 * the tactic's posterior and silence's posterior on one axis. Two curves sliding apart and
 * sharpening is what learning actually looks like, and it makes the sampler legible in a way
 * no summary does: the width is exactly how wild a Thompson draw out of this cell can roll.
 *
 * The axis carries no numbers on purpose. These are posteriors over the *reward* — a
 * logistic squash of relative lift with the interruption cost already subtracted — so the
 * units answer no question a human has, and printing them would invite reading a scale that
 * means nothing. Left/right and sharp/wide are the entire claim.
 *
 * Two curves, and that is now the whole panel. It used to carry three earlier snapshots of
 * the pair drawn faintly behind, plus a shaded region where the two still overlapped — eight
 * more paths in a box 64px tall, and both needed a written key to mean anything. When that
 * key came off as noise it took the marks with it: an unlabelled ghost is texture, and a
 * shaded crossing that is *not* P(this beats that) is a second quantity in a panel that
 * exists to show one. What is left is the comparison the row above states in words.
 */
function Density({
  mine,
  ctrl,
  tint,
}: {
  mine: Belief
  ctrl: Belief
  tint: string
}) {
  const shown = [mine, ctrl]
  // Wide enough to hold both curves whole, so neither is clipped into looking like it ran off
  // somewhere. A flat Beta(1, 1) opens this to the full [0, 1] on its own.
  const lo = Math.max(
    0,
    Math.min(...shown.map((b) => beliefMean(b) - 3.5 * beliefSd(b))),
  )
  const hi = Math.min(
    1,
    Math.max(...shown.map((b) => beliefMean(b) + 3.5 * beliefSd(b))),
  )

  const fMine = density(mine, lo, hi)
  const fCtrl = density(ctrl, lo, hi)

  // One vertical scale across both: heights are comparable, so a sharpening curve visibly
  // grows and a vague one stays a smear. Rescaling per curve would flatten the single most
  // informative difference on the panel. The headroom is so a posterior that peaks against
  // x=0 or x=1 — Beta(α, 1) after an unbroken run of wins does exactly that — reads as a
  // curve leaning on the wall rather than as a chart with its top sliced off.
  const peak = Math.max(...fMine, ...fCtrl, 1e-9) * 1.1
  const x = (i: number) => (i / (DSAMPLES - 1)) * DW
  const y = (v: number) => DH - (v / peak) * DH
  const path = (c: number[]) =>
    c
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join("")
  const tick = (b: Belief) => ((beliefMean(b) - lo) / (hi - lo || 1)) * DW

  return (
    <svg
      viewBox={`0 0 ${DW} ${DH}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ display: "block", height: DH }}
    >
      <path
        d={`${path(fCtrl)}L${DW},${DH}L0,${DH}Z`}
        fill="var(--text-secondary)"
        opacity={0.1}
      />
      <path
        d={path(fCtrl)}
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="1.5"
        strokeDasharray="3,2"
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={`${path(fMine)}L${DW},${DH}L0,${DH}Z`}
        fill={tint}
        opacity={0.14}
      />
      <path
        d={path(fMine)}
        fill="none"
        stroke={tint}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />

      {/* where each belief currently sits, so "further right" has something to land on */}
      <line
        x1={tick(ctrl)}
        x2={tick(ctrl)}
        y1={DH - 6}
        y2={DH}
        stroke="var(--text-secondary)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={tick(mine)}
        x2={tick(mine)}
        y1={DH - 6}
        y2={DH}
        stroke={tint}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** One tactic's line inside a state card: how sure, and how much it has to go on. */
function Track({
  state,
  arm,
  p,
  ctrlNow,
  series,
}: {
  state: ChatState
  arm: Arm
  p: Posterior
  /** silence's belief right now — the thing this row is drawn against */
  ctrlNow: Belief
  series: number[]
}) {
  const [open, setOpen] = useState(false)
  const now = series[series.length - 1]
  const cold = p.pulls < MIN_PULLS
  /** Never fired here. The row prints "—" rather than a percentage for these, and a line is
   *  a picture of the number the row is declining to print. It does move — silence keeps
   *  learning underneath an untried cell, so the trace drifts down — but that motion belongs
   *  to the control, not to this tactic, and four of these in a column is a card that looks
   *  like it has data when what it has is the same fact four times. */
  const untried = p.pulls === 0
  // Grey, not green or red: under MIN_PULLS the sampler ignores this cell, so colouring it
  // by direction would be the chart calling a race the policy is not running. Secondary
  // rather than muted, though — early in a session every cell is cold, and a grid of lines
  // too faint to see is a screen that looks broken rather than one that looks undecided.
  const tint = cold ? "var(--text-secondary)" : TINT[verdictOf(now)]
  const x = (i: number) => (i / (series.length - 1)) * CW
  const y = (v: number) => CH - clamp01(v) * CH
  const d = series
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join("")

  // The row's own grey is right for a cold *line*, but inside the density panel it is the
  // control's colour too, and two grey curves on one axis is a picture of nothing. The
  // panel needs the pair separable before it needs to stay uncommitted about the verdict,
  // so a cold arm goes white and the direction is still carried by the row above.
  const curveTint = cold ? "var(--text-primary)" : tint

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={reading(p, now, state, arm)}
        className="group flex w-full items-center gap-2 text-left"
        style={{ opacity: untried ? 0.6 : 1 }}
      >
        <span className="w-[88px] shrink-0 truncate text-body text-[var(--text-primary)]">
          {ARM_LABEL[arm]}
        </span>
        {/* The untried row keeps the column, not the drawing, so the three cards still line up
            row for row — a card whose rows are 20px shorter than its neighbour's is a worse
            trade than the empty space. */}
        {untried ? (
          <span className="min-w-0 flex-1" />
        ) : (
          <svg
            viewBox={`0 0 ${CW} ${CH}`}
            preserveAspectRatio="none"
            className="min-w-0 flex-1"
            style={{ display: "block", height: CH }}
          >
            {/* the coin flip — where every belief starts and where "no idea" stays */}
            <line
              x1={0}
              x2={CW}
              y1={y(0.5)}
              y2={y(0.5)}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="2,2"
              opacity={0.8}
              vectorEffect="non-scaling-stroke"
            />
            {/* the area between the trace and the coin flip: which side, and by how much */}
            <path
              d={`${d}L${CW},${y(0.5)}L0,${y(0.5)}Z`}
              fill={tint}
              opacity={0.18}
            />
            <path
              d={d}
              fill="none"
              stroke={tint}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        <span
          className="tnum w-9 shrink-0 text-right text-body font-bold"
          style={{ color: tint }}
        >
          {untried ? "—" : asPct(now)}
        </span>
        {/* Secondary, not muted, and at body size with the rest of the row. It is the second
            half of the readout — a percentage means one thing off twelve windows and another
            off one — so printing it a size down in the faintest grey on the palette hid the
            caveat and kept the claim. */}
        <span className="tnum w-8 shrink-0 text-right text-body text-[var(--text-secondary)]">
          {untried ? "new" : `×${p.pulls}`}
        </span>
        {/* Twelve identical glyphs at rest were a column of chrome down the middle of the
            screen, so it shows on hover and stays out while open. Rotated rather than swapped
            for a second glyph, so the row never reflows. */}
        <ChevronDown
          size={12}
          className={`shrink-0 text-[var(--text-muted)] transition-opacity group-hover:opacity-100 ${
            open ? "opacity-100" : "opacity-0"
          }`}
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div className="mb-1 mt-1.5 rounded-sm bg-[var(--bg-elevated)] px-2 pb-1.5 pt-2">
          <Density mine={p} ctrl={ctrlNow} tint={curveTint} />
          {/* A legend and nothing else. The gloss that used to sit under this panel — which
              direction is better, what the width means, what the grey is — was three lines of
              12px muted text under a 64px chart, and it read as the picture's footnotes
              rather than as its key. Two names against two curves is the whole legend. */}
          <div className="mt-1 flex items-baseline gap-x-2 text-body">
            <span style={{ color: curveTint }}>{ARM_LABEL[arm]}</span>
            <span className="text-[var(--text-secondary)]">
              vs staying quiet
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** What Gambit would do in one state right now. Three answers, and "staying quiet wins" is
 *  a real one — the old map could only phrase it as an absence ("nothing is clearly ahead"),
 *  which buries the single most interesting finding a session produces. */
type Call =
  | {
      kind: "arm"
      arm: Arm
      p: number
      lift: { mean: number; n: number } | null
    }
  | { kind: "quiet"; p: number }
  | { kind: "unknown"; tried: number }

/**
 * One chat state: the call, then the workings behind it.
 *
 * A state is a self-contained experiment, so it gets a self-contained card. The conclusion
 * sits at the top because a streamer mid-stream wants the conclusion; the three traces sit
 * under it because a judge wants to see it was earned.
 */
function StateCard({
  state,
  call,
  windows,
  children,
}: {
  state: ChatState
  call: Call
  windows: number
  children: React.ReactNode
}) {
  const edge =
    call.kind === "arm"
      ? "var(--kick-green)"
      : call.kind === "quiet"
        ? "var(--text-secondary)"
        : "var(--border)"

  const headline =
    call.kind === "arm"
      ? ARM_LABEL[call.arm]
      : call.kind === "quiet"
        ? "Stay quiet"
        : "Still finding out"

  // One line under the headline, not two. The card used to carry a confidence line and a
  // separate grey "workings" line beneath it — how many tactics had been tried, how many
  // windows each still needed, that the measurement was not clean yet. All of it true, none
  // of it readable at 12px in muted grey, and the rows directly below print the same counts.
  // What survives is the number the call was made on, plus the measured lift when there is
  // one, because that is the only figure on the card the rows do not already show.
  const sub =
    call.kind === "arm"
      ? `${asPct(call.p)} sure it beats staying quiet${call.lift ? ` · ${points(call.lift.mean)} avg` : ""}`
      : call.kind === "quiet"
        ? `${asPct(call.p)} sure silence is the better move here`
        : call.tried === 0
          ? "nothing tried here yet"
          : "no clear winner yet"

  return (
    <section
      className="flex min-w-[248px] flex-1 flex-col rounded-sm border bg-[var(--bg-surface)]"
      style={{ borderColor: edge, borderLeftWidth: 3 }}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
        <span className="text-body font-bold tracking-[0.18em] text-[var(--text-secondary)]">
          {STATE_LABEL[state]}
        </span>
        <span className="tnum shrink-0 text-body text-[var(--text-secondary)]">
          {windows} windows
        </span>
      </header>

      <div className="px-3 pb-3 pt-1">
        <div
          className="truncate text-stat font-semibold leading-tight"
          style={{
            color:
              call.kind === "unknown"
                ? "var(--text-secondary)"
                : "var(--text-primary)",
          }}
        >
          {headline}
        </div>
        <div
          className="tnum text-body leading-snug"
          style={{
            color:
              call.kind === "arm"
                ? "var(--kick-green)"
                : "var(--text-secondary)",
          }}
        >
          {sub}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-[var(--border)] px-3 py-2.5">
        {children}
      </div>
    </section>
  )
}

/** The empty state: what this surface will hold, once. The three-step account of the
 *  experiment that used to sit under it — one question per cell, silence as the thing to
 *  beat, every answer starting at a coin flip — is all three legible off the cards the
 *  moment there are cards, and every row on them says "sure it beats staying quiet" in
 *  words. */
function Empty({ cells }: { cells: number }) {
  return (
    <div className="flex justify-center py-10">
      <div className="w-full max-w-[440px] rounded-sm border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--kick-green)]">
          <FlaskConical size={18} />
        </div>
        <h3 className="mt-3 text-stat font-semibold text-[var(--text-primary)]">
          Three kinds of chat, {cells} questions
        </h3>
        <p className="mt-1.5 text-body leading-relaxed text-[var(--text-secondary)]">
          Each one asks whether a tactic beats staying quiet in that kind of
          chat. Every answer starts at a coin flip.
        </p>
      </div>
    </div>
  )
}

export default function PolicyMap({ s }: { s: GambitState }) {
  const posteriors = s.bandit?.posteriors ?? []
  const at = (state: ChatState, arm: Arm) =>
    posteriors.find((p) => p.state === state && p.arm === arm)
  // Rows come from the table, never from a list here: the backend defines the tactics
  // plus silence, and a hardcoded list would invent cells the sampler never considers.
  // `nothing` is not a row; it is the 50% line every other row is drawn against.
  const arms = [...new Set(posteriors.map((p) => p.arm))]
    .filter((a) => a !== "nothing")
    .sort()

  if (!posteriors.length || !arms.length) return <Empty cells={3 * 3} />

  const trail = (state: ChatState, arm: Arm) =>
    s.banditTrail[cellKey(state, arm)] ?? []
  /** The confidence trace for one cell, and the number it stands at now. */
  const seriesFor = (state: ChatState, arm: Arm): number[] => {
    const mine = at(state, arm)
    const ctrl = at(state, "nothing")
    if (!mine || !ctrl) return [0.5, 0.5]
    return trace(trail(state, arm), trail(state, "nothing"), pBeats(mine, ctrl))
  }

  /** What Gambit would do in one state, only counting cells the sampler itself is acting on.
   *  Under `MIN_PULLS` a cell is treated as unknown, so it can neither win nor lose here. */
  const callFor = (state: ChatState): Call => {
    const ctrl = at(state, "nothing")
    const tried = arms.filter((a) => (at(state, a)?.pulls ?? 0) > 0).length
    if (!ctrl) return { kind: "unknown", tried }
    const ranked = arms
      .map((arm) => ({
        arm,
        p: pBeats(at(state, arm)!, ctrl),
        pulls: at(state, arm)!.pulls,
      }))
      .filter((c) => c.pulls >= MIN_PULLS)
      .sort((a, b) => b.p - a.p)
    if (!ranked.length) return { kind: "unknown", tried }
    const top = ranked[0]
    if (top.p >= SURE) {
      return {
        kind: "arm",
        arm: top.arm,
        p: top.p,
        lift: measured(s.results, state, top.arm),
      }
    }
    // Even the best tactic here is behind silence by a margin we would call the other way.
    if (top.p <= 1 - SURE) return { kind: "quiet", p: 1 - top.p }
    return { kind: "unknown", tried }
  }

  return (
    // No scroller of its own: the page it sits on is one scrolling document now, and a panel
    // that scrolls inside a page that scrolls is two wheels for one list.
    <div className="@container space-y-3">
      {/* A heading and one number. This line used to carry the arithmetic behind the cell
          count, how many cells were still unasked, and a disclosure about which tactics
          qualify — and the cell count was the worst of them, because twelve cells are twelve
          rows directly underneath: it described the screen to someone already looking at it.
          The decision count is the one figure here that is nowhere else. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-body font-bold tracking-[0.18em] text-[var(--text-secondary)]">
          WHAT GAMBIT KNOWS
        </span>
        <span className="tnum text-body text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">
            {s.bandit?.decisions ?? 0}
          </span>{" "}
          decisions
        </span>
      </div>

      {/* One card per state, and deliberately no way to read across them: comparing a tactic
          between a lull and a spike compares the lull and the spike. */}
      <div className="flex flex-wrap gap-2">
        {STATES.map((st) => (
          <StateCard
            key={st}
            state={st}
            call={callFor(st)}
            windows={posteriors
              .filter((p) => p.state === st)
              .reduce((n, p) => n + p.pulls, 0)}
          >
            {arms.map((arm) => {
              const p = at(st, arm)
              const ctrlNow = at(st, "nothing")
              return (
                p &&
                ctrlNow && (
                  <Track
                    key={arm}
                    state={st}
                    arm={arm}
                    p={p}
                    ctrlNow={ctrlNow}
                    series={seriesFor(st, arm)}
                  />
                )
              )
            })}
          </StateCard>
        ))}
      </div>

      {/* Two things used to sit under the cards and both are gone for the same reason: the
          cards already say it. A footnote explained the axis the rows print in words on
          every line ("89% sure it beats staying quiet"), and "Last call" replayed the most
          recent Thompson draw — one number per arm, which is the sampler's arithmetic and
          not a question anybody brings to this tab. */}
    </div>
  )
}
