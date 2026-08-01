// The three live numbers, defined once.
//
// They appear twice — on the dashboard's Session Info strip and again at the top of Insights
// — and for a while each surface named, coloured and computed them itself. That drifted, the
// way duplicated definitions do: Insights dropped the third metric entirely, and the one it
// dropped was called "Actions" on a page whose main tab is also called Actions and means
// something else completely (a decision Gambit took). Both surfaces read this list now, so a
// rename or a recolour lands on both or on neither.
//
// `blurb` is not decoration. Every one of these is a windowed measurement with a specific
// definition — "13 talking" out of 635 viewers is 13 people in the last SIXTY SECONDS, not 13
// people in the stream — and a number whose window is invisible gets read as the wrong number.
import type { ContextFrame } from './types';
import type { GambitState } from './useGambit';

/** The window every one of these is measured over, server-side (`engagement.WINDOW_S`). */
export const METRIC_WINDOW_S = 60;

export type LiveMetric = {
  key: 'viewers' | 'talking' | 'activity';
  label: string;
  /** The line colour, shared by the strip's sparkline and the Insights chart. */
  color: string;
  /** What the number counts, in one line. Shown as a caption where there is room and as a
   *  tooltip where there is not — never nowhere. */
  blurb: string;
  /** The instant value, unit included, or `-` before the first frame. */
  value: (c: ContextFrame | null) => string;
  /** Bounded to the last ~90 samples — the dashboard strip's sparkline. */
  spark: (s: GambitState) => number[];
  /** The whole session, never truncated — the Insights chart, which scrolls and zooms. */
  history: (s: GambitState) => number[];
  /** The unit, for readouts that print a bare number. Counts have none; rates do. */
  unit?: string;
  /**
   * Series sharing a group share one y-scale.
   *
   * Talking and Activity are both per-60s chat quantities of the same order — 32 people
   * talking, 32 messages a minute — so they share, and equal numbers therefore draw at
   * equal heights. On separate scales each was normalised to its own max, and two 32s came
   * out at visibly different heights: a chart contradicting its own tooltip.
   *
   * Viewers is alone because it is twenty times larger. Grouped with the other two it
   * flattens both against the floor, which is what the Insights chart looked like when
   * Talking shared Viewers' scale — the metric the whole system optimises, unreadable.
   */
  scaleGroup?: string;
  /** Backdrop rather than subject — drawn thin and faint on the Insights chart. */
  dim?: boolean;
};

/** Kick's tokens have no line colours, and these three are ours rather than theirs. Declared
 *  here rather than in `tokens.css` for that reason — and declared ONCE, which is the point. */
const VIEWERS_COLOR = '#6aa9ff';
const TALKING_COLOR = 'var(--kick-green)';
const ACTIVITY_COLOR = 'var(--warn)';

const count = (n: number | null | undefined) => (n == null ? '-' : String(n));

/**
 * Ordered widest-to-narrowest: everyone watching, the share of them typing, and how hard
 * they are typing. Both surfaces render them in this order.
 */
export const LIVE_METRICS: LiveMetric[] = [
  {
    key: 'viewers',
    label: 'Viewers',
    color: VIEWERS_COLOR,
    blurb: 'People watching right now.',
    value: (c) => count(c?.viewer_count),
    spark: (s) => s.viewerSpark,
    history: (s) => s.viewerHistory,
    dim: true,
  },
  {
    key: 'talking',
    label: 'Talking',
    color: TALKING_COLOR,
    // `unique_chatters`. The metric the bandit is scored on: "participation" is this over
    // Viewers, and every lift on this page is in points of that ratio. Saying so is what
    // connects the strip at the top to the +pts figures everywhere below it.
    blurb: `Viewers who typed in the last ${METRIC_WINDOW_S}s — the number Gambit tries to raise.`,
    value: (c) => count(c?.unique_chatters),
    spark: (s) => s.activeViewersSpark,
    history: (s) => s.activeViewersHistory,
    scaleGroup: 'chat',
  },
  {
    key: 'activity',
    // NOT "Actions". That word is taken, by the thing this product actually does — the
    // Insights ledger is a list of actions Gambit took — and one screen cannot use it for
    // both without teaching everyone reading it to distrust the labels.
    label: 'Activity',
    color: ACTIVITY_COLOR,
    blurb: 'Messages plus reactions (redemptions, gifted Kicks) per minute.',
    value: (c) => (c ? `${c.actions_per_min.toFixed(1)}/min` : '-'),
    spark: (s) => s.actionsSpark,
    history: (s) => s.actionsHistory,
    // Shared with Talking, and the pair is worth reading against each other: Activity runs
    // at or above Talking by however much the room is saying beyond one line each.
    scaleGroup: 'chat',
    // Without it a readout prints `32` under Talking's `32` and invites the obvious wrong
    // conclusion. They are 32 PEOPLE and 32 MESSAGES A MINUTE.
    unit: '/min',
    dim: true,
  },
];
