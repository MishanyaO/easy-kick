// Review mode — R7 on real data. A pivot of the session that doubles as its filter, and one
// sortable ledger under it.
//
// This was four summary tiles over a grid of 84px cards inside collapsible verdict groups,
// and it lost on the only job the surface has: comparing things. Four tiles put four figures
// at four different x positions, so "is a lull better than a spike" meant reading three
// separate blocks and holding them in your head. The card grid was worse — a wrapping
// masonry of fixed-height cards has no columns, so no value on it can be scanned down, and
// the collapsible groups hid the comparison behind a click each.
//
// Both are tables now, because every question this page is asked is a comparison:
//
//   The pivot is chat state × outcome, counted. It answers "where is this session actually
//   spending its windows" at a glance, and every cell in it is a filter — click the LULL
//   row's BACKFIRED cell and the ledger below is those windows. A row header filters the
//   state, a column header the outcome, the same cell again clears it. A summary that is
//   also the control is one object to learn instead of two, which is how the old filter
//   tiles and the old group headers collapse into a single thing.
//
//   The ledger is one row per window on a fixed column grid, so time, state, tactic, verdict
//   and lift each read down a column, and any of them sorts. Sorting is what replaced the
//   verdict groups: "show me the worst backfires" is a click on LIFT, not a hunt through an
//   expanded section. Rows are ~32px instead of 84px cards, so roughly three times as much
//   of the session is on screen at once.
//
// Colour is spent in exactly one place — the VERDICT and LIFT columns, side by side at the
// right, reading as one unit. The old cards carried the same verdict three times over, as a
// left border, a coloured group heading and a coloured number.
import { useEffect, useState } from 'react';
import { ChevronRight, Radar } from 'lucide-react';
import type { GambitState } from '../useGambit';
import {
  ARM_LABEL, NOISE_BAND, STATE_LABEL, STATE_PHRASE, VERDICT_BLURB, VERDICT_COLOR, clock,
  isControl, labelFor, peopleShort, points, whyUnattributable,
  type Arm, type ChatState, type VerdictLabel,
} from '../types';
import InsightsGraph from './InsightsGraph';
import PolicyMap from './PolicyMap';
import ResultDetail, { type History, type LedgerRow } from './ResultDetail';
import { LIVE_METRICS } from '../metrics';

type Row = LedgerRow;
type Tab = 'actions' | 'tactics';

/** Which pile a window lands in: the four verdicts, plus the two piles that are not verdicts
 *  — windows that never reached chat, and the ones where staying quiet was the decision. */
type Section = VerdictLabel | 'unsent' | 'control';
/** The pivot's row axis. `all` is the totals row, and also the "no state filter" value. */
type StateKey = 'all' | ChatState;

/** `tactics` stays the state key — the tab is still where you go to ask "what works?" —
 *  but the surface behind it is a map of beliefs now, and "Tactics" undersold it. */
const TABS: [Tab, string][] = [['actions', 'Actions'], ['tactics', 'Policy map']];

const STATES: ChatState[] = ['lull', 'steady', 'spike'];
/** A tactic needs this many tries in a state before its average is worth reading aloud. */
const MIN_TRIES = 2;

/** Every cell on both tables sits on the same hairline grid. One constant, so a column added
 *  to either can't quietly ship at a different density from the rest of the row. */
const CELL = 'border-b border-[var(--border)] px-2 py-1.5';
const HEAD = 'text-label font-bold tracking-[0.14em]';
/**
 * The ledger's heading cells, pinned to the page's scroller.
 *
 * Each cell sticks on its own rather than the `<thead>` sticking as a block, because Chrome
 * does not apply `z-index` to a table row group: the header stayed put but the rows scrolled
 * straight through it, printing one row of the ledger on top of another. Per-cell, each
 * heading is an ordinary positioned box with its own opaque background and the stacking works.
 */
const STICKY = 'sticky top-0 z-10 bg-[var(--bg-base)]';

/** A window that never reached chat: skipped, expired, or the send itself failed. */
const isUnsent = (r: Row) => r.outcome === 'dismissed' || r.outcome === 'send_failed';

/** What a summed lift is worth saying in, inside the noise band and out of it. Shared by the
 *  hero and the pivot's NET LIFT column because they print the same figure — the hero used
 *  to be unconditionally green, which meant a losing session announced its loss in the
 *  colour of a win, directly above the same number in red. */
const liftTint = (v: number) => (v > NOISE_BAND ? 'var(--kick-green)'
  : v < -NOISE_BAND ? 'var(--danger)' : 'var(--text-secondary)');

/** Which pile a row belongs to. Controls and never-sents get their own rather than a
 *  verdict, so this cannot just be `labelFor`. */
const sectionOf = (r: Row): Section =>
  isControl(r) ? 'control' : isUnsent(r) ? 'unsent' : labelFor(r);

/**
 * The pivot's column axis, in the order a session is read: what worked, then what didn't,
 * then what could not be read at all, then the two piles that were never interventions.
 *
 * Two names each. `head` has to survive a 100px column, so it is as short as the word can be
 * cut; `long` is what the same pile is called in a sentence, where there is room to say it
 * properly. `note` is the column's tooltip — a header of six one-word outcomes is six words
 * six people will read six ways, and CAN'T TELL in particular means something specific here.
 */
const SECTIONS: { key: Section; head: string; long: string; color: string; note: string }[] = [
  { key: 'Worked', head: 'WORKED', long: 'worked',
    color: VERDICT_COLOR.Worked, note: VERDICT_BLURB.Worked },
  { key: 'Neutral', head: 'NEUTRAL', long: 'neutral',
    color: VERDICT_COLOR.Neutral, note: VERDICT_BLURB.Neutral },
  { key: 'Backfired', head: 'BACKFIRED', long: 'backfired',
    color: VERDICT_COLOR.Backfired, note: VERDICT_BLURB.Backfired },
  { key: "Can't tell", head: "CAN'T TELL", long: "can't tell",
    color: VERDICT_COLOR["Can't tell"], note: VERDICT_BLURB["Can't tell"] },
  { key: 'unsent', head: 'UNSENT', long: 'never sent', color: 'var(--text-secondary)',
    note: 'you skipped these, or they expired waiting, or the send failed — nothing went to chat' },
  { key: 'control', head: 'QUIET', long: 'stayed quiet', color: 'var(--text-muted)',
    note: 'the control every intervention is measured against — deliberate quiet windows, scored the same way' },
];

/** The ledger's sort order for VERDICT, and the pivot's column order. One list, so sorting by
 *  verdict walks the pivot left to right. */
const SECTION_ORDER = SECTIONS.map((s) => s.key);
/** The prose name of a pile, for the caption and the empty line. */
const SECTION_LONG = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s.long]),
) as Record<Section, string>;

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
 * The empty state: what will appear here, once. It used to carry a three-step account of the
 * watch/act/measure loop underneath, which is the product pitch printed on a screen a
 * streamer sees for thirty seconds and never again — and every step of it is legible from
 * the ledger the moment there is one row in it.
 */
function Empty() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-full max-w-[440px] rounded-sm border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--kick-green)]">
          <Radar size={18} />
        </div>
        <h3 className="mt-3 text-stat font-semibold text-[var(--text-primary)]">
          No closed windows yet
        </h3>
        <p className="mt-1.5 text-body leading-relaxed text-[var(--text-secondary)]">
          Every decision opens a 60-second window and lands here when it closes — including
          the decisions to stay quiet.
        </p>
      </div>
    </div>
  );
}

/**
 * One count in the pivot, and the filter that count describes.
 *
 * The cross highlight is the whole reason a pivot is readable: you find a number by tracking
 * a row and a column to where they meet, so both arms of the current selection are lit and
 * only their intersection goes green. Without it "which cell am I in" is a question the
 * table makes you answer.
 */
function Cell({ st, sec, n, at, strong, onPick }: {
  st: StateKey;
  sec: Section | 'all';
  n: number;
  /** Where the filter currently is, for the cross. */
  at: { state: StateKey; section: Section | 'all' };
  /** The row's own total — the one figure per row that carries weight. */
  strong?: boolean;
  onPick: (state: StateKey, section: Section | 'all') => void;
}) {
  const here = at.state === st && at.section === sec;
  const arm = at.state === st || at.section === sec;
  const bg = here
    ? 'bg-[var(--kick-green)]/15 hover:bg-[var(--kick-green)]/25'
    : arm
      ? 'bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]'
      : 'hover:bg-[var(--bg-elevated)]';

  return (
    <td className="border-b border-[var(--border)] p-0">
      <button onClick={() => onPick(st, sec)}
        title={`${st === 'all' ? 'Every state' : STATE_LABEL[st]} · ${
          sec === 'all' ? 'every outcome' : SECTION_LONG[sec]
        } — ${n} ${n === 1 ? 'window' : 'windows'}`}
        className={`tnum block w-full px-2 py-1.5 text-right text-body transition-colors ${bg}`}
        style={{
          color: here ? 'var(--kick-green)'
            : n === 0 ? 'var(--text-muted)'
              : strong ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: here || strong ? 600 : 400,
        }}>
        {n}
      </button>
    </td>
  );
}

/**
 * The session as a pivot: chat state down, outcome across, windows counted.
 *
 * It is the summary and the filter at once. That is not a shortcut — a count you can see but
 * not open is a number you then have to go and find by hand, and a filter with no count on
 * it is a control you have to click to learn whether it was worth clicking.
 */
function Pivot({ results, at, onPick }: {
  results: Row[];
  at: { state: StateKey; section: Section | 'all' };
  onPick: (state: StateKey, section: Section | 'all') => void;
}) {
  return (
    // `table-fixed`, so a long finding in BEST TACTIC truncates inside its column instead of
    // shoving the count columns out of alignment — it is the only cell here whose width is
    // not knowable in advance, and the only one it is safe to cut.
    <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-base)]">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <thead>
          <tr>
            {/* Wide enough for EVERYTHING at body size with the row labels' tracking on it —
                the totals row is the one label here that is a word rather than a state. */}
            <th className={`${CELL} ${HEAD} w-[144px] whitespace-nowrap text-left text-[var(--text-muted)]`}>
              CHAT STATE
            </th>
            <th className="w-[86px] border-b border-[var(--border)] p-0">
              <button onClick={() => onPick(at.state, 'all')}
                title="Every outcome, including the windows that never fired"
                className={`${HEAD} block w-full whitespace-nowrap px-2 py-1.5 text-right transition-colors hover:bg-[var(--bg-elevated)]`}
                style={{ color: at.section === 'all' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                WINDOWS
              </button>
            </th>
            {SECTIONS.map((c) => (
              <th key={c.key} className="w-[100px] border-b border-[var(--border)] p-0">
                <button onClick={() => onPick(at.state, c.key)} title={c.note}
                  className={`${HEAD} block w-full whitespace-nowrap px-2 py-1.5 text-right transition-colors hover:bg-[var(--bg-elevated)]`}
                  style={{
                    color: c.color,
                    opacity: at.section === 'all' || at.section === c.key ? 1 : 0.5,
                  }}>
                  {c.head}
                </button>
              </th>
            ))}
            <th className={`${CELL} ${HEAD} w-[92px] whitespace-nowrap text-right text-[var(--text-muted)]`}
              title="Every fired window in this state, summed — in participation points">
              NET LIFT
            </th>
            <th className={`${CELL} ${HEAD} hidden whitespace-nowrap text-left text-[var(--text-muted)] xl:table-cell`}
              title={`The highest measured average in this state, over at least ${MIN_TRIES} tries`}>
              BEST TACTIC
            </th>
          </tr>
        </thead>
        <tbody>
          {(['all', ...STATES] as StateKey[]).map((st) => {
            const set = st === 'all' ? results : results.filter((r) => r.state === st);
            const fired = set.filter((r) => r.outcome === 'fired');
            const lift = fired.reduce((a, r) => a + r.engagement_delta, 0);
            const best = st === 'all' ? undefined : bestTactic(results, st);
            return (
              <tr key={st}>
                <th scope="row" className="border-b border-[var(--border)] p-0 text-left">
                  <button onClick={() => onPick(st, at.section)}
                    title={st === 'all' ? 'Every state'
                      : `Only windows that closed while ${STATE_PHRASE[st]}`}
                    className={`block w-full truncate px-2 py-1.5 text-left text-body font-bold tracking-[0.14em] transition-colors ${
                      at.state === st
                        ? 'bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]'
                        : 'hover:bg-[var(--bg-elevated)]'
                    }`}
                    style={{ color: at.state === st ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {st === 'all' ? 'EVERYTHING' : STATE_LABEL[st]}
                  </button>
                </th>
                <Cell st={st} sec="all" n={set.length} at={at} onPick={onPick} strong />
                {SECTIONS.map((c) => (
                  <Cell key={c.key} st={st} sec={c.key} at={at} onPick={onPick}
                    n={set.filter((r) => sectionOf(r) === c.key).length} />
                ))}
                <td className={`${CELL} tnum text-right text-body font-bold`}
                  style={{ color: liftTint(lift) }}>
                  {points(lift)}
                </td>
                <td className={`${CELL} hidden truncate text-left text-body xl:table-cell`}>
                  {st === 'all' ? (
                    // Not a gap in the data — a comparison this page refuses to make. A
                    // spike out-chats a lull whatever fired in it, so a "best overall" would
                    // be naming the busiest state, dressed up as a tactic. The refusal is a
                    // dash and a tooltip, not a sentence: it is the totals row of a table
                    // whose other three rows carry the answer.
                    <span className="text-[var(--text-muted)]"
                      title="Tactics are ranked only within a state — across them you would be ranking the states.">
                      —
                    </span>
                  ) : best ? (
                    <span className="text-[var(--text-secondary)]">
                      <span className="text-[var(--text-primary)]">{ARM_LABEL[best.arm]}</span>{' '}
                      <span className="tnum">{points(best.mean)}</span> over {best.tries}
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">
                      {fired.length === 0 ? 'nothing tried here yet' : 'nothing beats silence here yet'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SortKey = 'time' | 'state' | 'tactic' | 'verdict' | 'lift';
/** Where each column starts when you first click it: newest and biggest first for the two
 *  with an interesting end, A→Z for the ones without. */
const SORT_DIR: Record<SortKey, 1 | -1> = {
  time: -1, state: 1, tactic: 1, verdict: 1, lift: -1,
};

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case 'time': return a.tick - b.tick;
    case 'state': return STATES.indexOf(a.state) - STATES.indexOf(b.state);
    case 'tactic': return ARM_LABEL[a.arm].localeCompare(ARM_LABEL[b.arm]);
    case 'verdict':
      return SECTION_ORDER.indexOf(sectionOf(a)) - SECTION_ORDER.indexOf(sectionOf(b));
    case 'lift': return a.engagement_delta - b.engagement_delta;
  }
}

/** A sortable ledger heading. The arrow appears only on the column actually in use — three
 *  greyed-out arrows on a header row is a header row of arrows. */
function Th({ k, label, sort, onSort, width, right, title }: {
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  width: string;
  right?: boolean;
  title?: string;
}) {
  const on = sort.key === k;
  return (
    <th className={`${width} ${STICKY} border-b border-[var(--border)] p-0 font-normal`}>
      <button onClick={() => onSort(k)}
        title={title ? `${title}. Click to sort.` : `Sort by ${label.toLowerCase()}`}
        className={`${HEAD} flex w-full items-center gap-1 px-2 py-1.5 transition-colors hover:text-[var(--text-primary)] ${
          right ? 'justify-end' : ''
        }`}
        style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>
        {label}
        <span className="w-2 shrink-0 text-left">{on ? (sort.dir === 1 ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}

/** One window, and its detail when the streamer opens it. Two `<tr>`s: the detail spans the
 *  full width, which it cannot do while sharing the row's column grid. */
function Entry({ r, history, bandit, chat, open, onToggle }: {
  r: Row;
  history: History;
  bandit: GambitState['bandit'];
  chat: GambitState['chat'];
  open: boolean;
  onToggle: () => void;
}) {
  const section = sectionOf(r);
  const control = section === 'control';
  const unsent = section === 'unsent';
  const caveat = whyUnattributable(r);
  const crowd = r.outcome === 'fired' && !r.contaminated
    ? peopleShort(r.engagement_delta, history.viewers[r.tick])
    : null;
  const votes = Object.entries(r.votes).filter(([, n]) => n > 0);
  // One column, several things it might have to say, in the order a reader needs them: why
  // the number cannot be read, then how many people that lift actually is, then how chat
  // answered. All three are progressive detail — the row is complete without any of them.
  const note = caveat
    ?? crowd
    ?? (votes.length ? votes.map(([k, n]) => `${k} ${n}`).join(' · ') : null)
    ?? (control ? 'control window' : null);
  const at = history.elapsed[r.tick];
  // Grey for the two piles that are not verdicts, and the same two greys the pivot's columns
  // use — a never-sent window inherits "Can't tell" from `labelFor`, and printing it in that
  // amber would say a measurement went wrong when in fact none was ever attempted.
  const tint = control ? 'var(--text-muted)'
    : unsent ? 'var(--text-secondary)'
      : VERDICT_COLOR[labelFor(r)];

  return (
    <>
      {/* `data-row` so a click on the chart's pin can find this row and scroll to it. */}
      <tr data-row={r.action_id} onClick={onToggle}
        className={`cursor-pointer transition-colors hover:bg-[var(--bg-elevated)] ${
          open ? 'bg-[var(--bg-elevated)]' : ''
        }`}>
        <td className="border-b border-[var(--border)] p-0 align-middle">
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-expanded={open} aria-label={open ? 'Close this window' : 'Open this window'}
            className="flex w-7 items-center justify-center py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <ChevronRight size={13}
              style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
          </button>
        </td>
        <td className={`${CELL} tnum truncate text-body text-[var(--text-muted)]`}>
          {at != null ? clock(at) : '—'}
        </td>
        <td className={`${CELL} truncate text-label font-bold tracking-[0.12em] text-[var(--text-muted)]`}>
          {STATE_LABEL[r.state]}
        </td>
        <td className={`${CELL} truncate text-body text-[var(--text-secondary)]`}>
          {ARM_LABEL[r.arm]}
        </td>
        <td className={`${CELL} truncate text-body text-[var(--text-primary)]`}
          title={r.action?.body ?? undefined}>
          {r.action?.body ? `“${r.action.body}”` : (
            <span className="text-[var(--text-muted)]">
              {control ? 'chose not to intervene' : r.outcome.replace('_', ' ')}
            </span>
          )}
        </td>
        <td className={`${CELL} hidden truncate text-label lg:table-cell`} title={note ?? undefined}
          style={{ color: caveat ? 'var(--warn)' : 'var(--text-muted)' }}>
          {note}
        </td>
        <td className={`${CELL} truncate text-body`} style={{ color: tint }}>
          {control ? 'Control' : unsent ? 'Not sent' : labelFor(r)}
        </td>
        {/* A window that never fired gets no figure at all — printing +0.0 pts against it
            invents a measurement that was never taken. */}
        <td className={`${CELL} tnum pr-2.5 text-right text-body font-bold`} style={{ color: tint }}>
          {unsent ? (
            <span className="font-normal text-[var(--text-muted)]"
              title="Nothing was sent, so nothing was measured.">
              —
            </span>
          ) : points(r.engagement_delta)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="border-b border-[var(--border)] p-0">
            <ResultDetail r={r} h={history} bandit={bandit} chat={chat} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Review({ s }: { s: GambitState }) {
  const [tab, setTab] = useState<Tab>('actions');
  const [state, setState] = useState<StateKey>('all');
  const [section, setSection] = useState<Section | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);

  const onSort = (k: SortKey) =>
    setSort((p) => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : SORT_DIR[k] }));

  const clear = () => { setState('all'); setSection('all'); };

  const pick = (st: StateKey, sec: Section | 'all') => {
    // Clicking the cell you are already in is the way back out of it. Without that, the only
    // route to "everything" is a corner you have to be told about.
    if (st === state && sec === section) return clear();
    setState(st);
    setSection(sec);
  };

  // Clicking a pin on the chart opens that window's row down here. Two things have to be
  // true for it to be visible — the right tab, and a filter that does not exclude it — and
  // quietly doing one of the two is worse than doing neither.
  const select = (hit: { action_id: string }) => {
    const row = s.results.find((r) => r.action_id === hit.action_id);
    if (!row) return;
    setTab('actions');
    clear();
    setExpanded(row.action_id);
  };

  // Scroll it into view once the filter change that revealed it has actually rendered.
  // Centred rather than `nearest`: the page is one long scroller with a pinned ledger
  // header, and `nearest` is happy to park the row it just opened underneath it.
  useEffect(() => {
    if (!expanded) return;
    document.querySelector(`[data-row="${CSS.escape(expanded)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [expanded]);

  // The whole-session series a row's detail draws its window against.
  const history: History = {
    active: s.activeViewersHistory,
    viewers: s.viewerHistory,
    elapsed: s.historyElapsedS,
  };

  const rows = s.results
    .filter((r) => (state === 'all' || r.state === state)
      && (section === 'all' || sectionOf(r) === section))
    .sort((a, b) => {
      // Unsent windows hold no measurement, so they sit at the bottom of a LIFT sort in
      // either direction rather than posing as the session's biggest drop.
      if (sort.key === 'lift') {
        const gap = (isUnsent(a) ? 1 : 0) - (isUnsent(b) ? 1 : 0);
        if (gap) return gap;
      }
      // Time breaks every tie, so equal lifts and repeated tactics still land in a stable,
      // meaningful order instead of whatever the filter happened to produce.
      return compare(a, b, sort.key) * sort.dir || a.tick - b.tick;
    });

  const allFired = s.results.filter((r) => r.outcome === 'fired');
  const totalLift = allFired.reduce((a, r) => a + r.engagement_delta, 0);
  const filtered = state !== 'all' || section !== 'all';

  // `tick` is the history array index a result closed under — history is never
  // truncated, so it lines up directly with viewerHistory/activeViewersHistory/actionsHistory.
  const interventions = allFired.map((r) => ({ index: r.tick, result: r }));

  return (
    // No height, background, padding or scrolling of its own — the host owns all four, so
    // this renders correctly both as a full page and inside a panel.
    //
    // Scrolling in particular. This used to pin everything above the ledger and scroll the
    // ledger inside its own box, which put a short scrollbar in the middle of the screen and
    // a second one on the page: the wheel did different things depending on where the pointer
    // happened to be, and the rows you were reading had a viewport a third the height of the
    // one you were looking at. One document, one scrollbar. The ledger's header is sticky, so
    // the columns stay named however far down you go — which was the only thing the inner
    // scroller was actually buying.
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="tnum text-hero font-bold leading-none" style={{ color: liftTint(totalLift) }}>
          {points(totalLift)}
        </span>
        <div className="min-w-0">
          {/* The sentence follows the sign. A session that lost ground still gets one headline
              figure — it just does not get to call it a gain. */}
          <div className="text-lead font-medium text-[var(--text-primary)]">
            {totalLift > NOISE_BAND ? 'more of the audience talking'
              : totalLift < -NOISE_BAND ? 'less of the audience talking'
                : 'no change in how much of the audience talks'}
          </div>
          {/* The count, and not the methodology. "summed matched-control lift, in
              participation points" defined the hero figure's unit in muted 14px directly
              under a 32px number — the one place on the page where a reader is looking at
              the number and not at prose about it. The LIFT column header still carries the
              definition, on the table where a unit is actually being compared. */}
          <div className="tnum text-body text-[var(--text-secondary)]">
            {allFired.length} interventions
          </div>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-sm border border-[var(--border)] p-0.5">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3.5 py-1.5 text-body font-semibold ${
                tab === k ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-sm border border-[var(--border)] px-3 py-2">
        <InsightsGraph
          // The same three metrics as the dashboard's Session Info strip, in the same order
          // and the same colours, read from the same list — the legend prints their live
          // values too, so the two surfaces open on the identical row of numbers.
          //
          // Talking is the subject — it is what the bandit is scored on — so it is the only
          // one drawn solid; Viewers and Activity are backdrops it moves against. Which of
          // them share a y-scale is `metrics.ts`, and it is the whole reason equal numbers
          // draw at equal heights.
          //
          // Activity is back after a spell as `msgs_per_min`, which was the same curve as
          // Talking drawn twice. It is `actions_per_min` now, so it carries what Talking
          // cannot: redemptions and gifted Kicks, chat doing something other than typing.
          series={LIVE_METRICS.map((m) => ({
            data: m.history(s),
            color: m.color,
            label: m.label,
            value: m.value(s.context),
            hint: m.blurb,
            unit: m.unit,
            scaleGroup: m.scaleGroup,
            dim: m.dim,
          }))}
          interventions={interventions}
          elapsedS={s.historyElapsedS}
          viewers={s.viewerHistory}
          onSelect={select}
        />
      </div>

      {tab === 'tactics' ? (
        <div className="mt-4"><PolicyMap s={s} /></div>
      ) : s.results.length === 0 ? (
        // Before the pivot, not under it: a table of zeroes reads as a broken dashboard,
        // where the same emptiness explained reads as a system waiting to run.
        <Empty />
      ) : (
        <>
          <div className="mt-4">
            <Pivot results={s.results} at={{ state, section }} onPick={pick} />
          </div>

          {/* What the ledger below is showing, and the way back out of it — and nothing at
              all when nothing is filtered. The unfiltered line used to spell out how to work
              the two tables: click a count, click a heading, click a row. Three instructions
              for three affordances that are already a cursor change and a hover away, printed
              permanently above the thing they describe. */}
          {filtered && (
            <div className="mt-2.5 flex items-baseline gap-3 text-body">
              <span className="min-w-0 truncate text-[var(--text-muted)]">
                Showing{' '}
                <span className="text-[var(--text-primary)]">
                  {state === 'all' ? 'every state' : STATE_LABEL[state]}
                </span>
                {' · '}
                <span className="text-[var(--text-primary)]">
                  {section === 'all' ? 'every outcome' : SECTION_LONG[section]}
                </span>
                {' — '}
                <span className="tnum">{rows.length}</span>{' '}
                {rows.length === 1 ? 'window' : 'windows'}
              </span>
              <button onClick={clear}
                className="ml-auto shrink-0 text-[var(--kick-green)] hover:underline">
                show everything
              </button>
            </div>
          )}

          <div className="mt-2.5 rounded-sm border border-[var(--border)] bg-[var(--bg-base)]">
            <table className="w-full table-fixed border-separate border-spacing-0">
              {/* Pinned to the page's scroller, cell by cell — see `STICKY`. A header that
                  lets three hundred rows slide under it is a header nobody can read past the
                  first screenful, and the whole argument for a table over cards is that the
                  columns stay named however far down the session you are. */}
              <thead>
                <tr>
                  <th className={`w-7 ${STICKY} border-b border-[var(--border)] p-0`}>
                    <span className="sr-only">Open</span>
                  </th>
                  <Th k="time" label="TIME" sort={sort} onSort={onSort} width="w-[84px]"
                    title="When the measurement window closed, on the session clock" />
                  <Th k="state" label="STATE" sort={sort} onSort={onSort} width="w-[78px]"
                    title="What chat was doing when the window opened" />
                  <Th k="tactic" label="TACTIC" sort={sort} onSort={onSort} width="w-[116px]" />
                  {/* The two elastic columns, in proportion rather than "one takes the rest".
                      Sized off the table instead of in pixels because they are the two whose
                      content has no natural width — and a line column given all the slack
                      leaves a hand's width of nothing between a short line and its note. */}
                  <th className={`${CELL} ${HEAD} ${STICKY} w-[44%] text-left text-[var(--text-muted)]`}>
                    WHAT IT SAID
                  </th>
                  <th className={`${CELL} ${HEAD} ${STICKY} hidden w-[20%] text-left text-[var(--text-muted)] lg:table-cell`}
                    title="How many people that lift is, how chat answered, or why the number cannot be read">
                    NOTE
                  </th>
                  <Th k="verdict" label="VERDICT" sort={sort} onSort={onSort} width="w-[100px]" />
                  <Th k="lift" label="LIFT" sort={sort} onSort={onSort} width="w-[96px]" right
                    title="Matched-control lift, in participation points" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Entry key={r.action_id + i} r={r}
                    history={history} bandit={s.bandit} chat={s.chat}
                    open={expanded === r.action_id}
                    onToggle={() => setExpanded(expanded === r.action_id ? null : r.action_id)} />
                ))}
              </tbody>
            </table>

            {/* Not "nothing has happened" — something has, this cell is just empty. Which
                cell is already named in the caption directly above, so saying it again here
                would be the third place on screen printing the same filter. */}
            {rows.length === 0 && (
              <p className="px-3 py-8 text-center text-body text-[var(--text-muted)]">
                Nothing has closed here yet. Pick another cell, or{' '}
                <button onClick={clear} className="text-[var(--kick-green)] hover:underline">
                  show everything
                </button>.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
