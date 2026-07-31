// One closed window, opened up.
//
// The collapsed row is a ledger entry: state, tactic, number. This is the four things it
// cannot fit — the full line, what chat did while it ran, how chat answered, and what the
// number was measured against — and deliberately nothing else. An expanded row is read
// mid-stream, so every sentence it holds has to earn its line; the reasoning that used to
// live here in prose is now a tooltip, and the engineer's numbers are behind a disclosure.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  ARM_LABEL, ORIGIN_LABEL, VERDICT_COLOR, clock, labelFor, points, whyThisArm,
  whyUnattributable, type ActionFrame, type BanditFrame, type ChatFrame, type ResultFrame,
} from '../types';
import { BOT_NAME } from '../useGambit';

export type LedgerRow = ResultFrame & { action?: ActionFrame; tick: number };

/** The session series the detail draws a single window against. */
export type History = { active: number[]; viewers: number[]; elapsed: number[] };

const WINDOW_S = 60; // the measurement window every decision opens
const LEAD_S = 120; // how much run-up to draw before it, for context

/** How much of the room to show around the bot's line. Enough before it to see what chat
 *  was already on about, and enough after to see whether anyone picked it up. */
const SAY_BEFORE = 3;
const SAY_AFTER = 7;
/** How close the nearest kept message has to be for the transcript to be about this action
 *  at all — in a lull the room can be quiet for a while, but not for minutes. */
const NEAR_S = 90;

const CW = 260;
const CH = 40;

/** Nearest sample to an elapsed time. Sessions are a few thousand samples and this runs on
 *  a click, so a scan is cheaper than the index it would take to avoid one. */
function nearest(elapsed: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < elapsed.length; i++) {
    if (Math.abs(elapsed[i] - target) < Math.abs(elapsed[best] - target)) best = i;
  }
  return best;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, n) => a + n, 0) / xs.length : 0);

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-sm bg-[var(--bg-surface)] px-2.5 py-2">
      <div className="text-label font-bold tracking-[0.18em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * People talking through the window, with the window itself shaded.
 *
 * Deliberately the *naive* picture — the raw line, before and during, no correction — and
 * labelled as such. It is what the streamer watched happen, and the gap between it and the
 * matched number in the row is the mean reversion that number has already taken out.
 */
function WindowChart({ h, closeIdx, tint }: { h: History; closeIdx: number; tint: string }) {
  const closeS = h.elapsed[closeIdx];
  if (closeS == null || h.active.length < 4) return null;

  const startIdx = nearest(h.elapsed, closeS - WINDOW_S);
  const lo = nearest(h.elapsed, closeS - WINDOW_S - LEAD_S);
  // Never crop the window itself: a paused or restarted gym can put duplicate elapsed
  // values in the series, and `nearest` would then land before the close it was given.
  const hi = Math.min(h.active.length - 1,
    Math.max(closeIdx, nearest(h.elapsed, closeS + LEAD_S / 2)));
  if (hi - lo < 3 || startIdx <= lo || closeIdx <= startIdx) return null;

  const visible = h.active.slice(lo, hi + 1);
  const top = Math.max(1, ...visible) * 1.2;
  const x = (i: number) => ((i - lo) / (hi - lo)) * CW;
  const y = (v: number) => CH - (v / top) * (CH - 4) - 2;
  const d = visible
    .map((v, j) => `${j === 0 ? 'M' : 'L'}${x(lo + j).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');

  const before = mean(h.active.slice(lo, startIdx));
  const during = mean(h.active.slice(startIdx, closeIdx + 1));

  return (
    <div>
      <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: CH }}>
        <rect x={x(startIdx)} y={0} width={Math.max(1, x(closeIdx) - x(startIdx))} height={CH}
          fill={tint} opacity={0.13} />
        <line x1={x(startIdx)} x2={x(startIdx)} y1={0} y2={CH} stroke={tint} strokeWidth="1"
          vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--kick-green)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-baseline gap-1.5 text-label"
        title="Raw before and during, uncorrected — the shaded band is the 60s window">
        <span className="tnum text-[var(--text-secondary)]">{before.toFixed(1)}</span>
        <span className="text-[var(--text-muted)]">→</span>
        <span className="tnum font-semibold text-[var(--text-primary)]">{during.toFixed(1)}</span>
        <span className="text-[var(--text-muted)]">talking</span>
      </div>
    </div>
  );
}

/** A closed poll's split. Votes are keyed by the option text the bot posted. */
function Votes({ votes, options }: { votes: Record<string, number>; options?: string[] }) {
  const keys = options?.length ? options : Object.keys(votes);
  const total = keys.reduce((a, k) => a + (votes[k] ?? 0), 0);
  if (!total) return null;
  const top = Math.max(...keys.map((k) => votes[k] ?? 0));

  return (
    <div className="space-y-1">
      {keys.map((k) => {
        const n = votes[k] ?? 0;
        const won = n === top;
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-label"
              style={{ color: won ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {k}
            </span>
            <div className="h-1.5 flex-1 rounded-sm bg-[var(--bg-elevated)]">
              <div className="h-1.5 rounded-sm"
                style={{ width: `${(n / total) * 100}%`,
                  background: won ? 'var(--kick-green)' : 'var(--text-muted)' }} />
            </div>
            <span className="tnum w-9 shrink-0 text-right text-label text-[var(--text-secondary)]">
              {Math.round((n / total) * 100)}%
            </span>
          </div>
        );
      })}
      <p className="tnum text-label text-[var(--text-muted)]"
        title="One vote each, first answer counts — deduped by viewer">
        {total} voted
      </p>
    </div>
  );
}

/**
 * The room around the bot's line.
 *
 * The lift says whether chat moved. It cannot say what chat was *on about*, and that is the
 * first thing anyone asks of a result that surprises them — the number is the finding, this
 * is whether the finding is believable. Our own line is marked, so you can see it land.
 */
function Transcript({ chat, at }: { chat: ChatFrame[]; at: string }) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  // Chat arrives in order, so the first message at or after the action is the split point.
  const i = chat.findIndex((m) => Date.parse(m.ts) >= t);
  if (i < 0) return null;
  // The backlog only reaches so far back. Past its edge this would happily print the oldest
  // messages it has, from some other minute entirely, under a heading that says they are
  // the room around this action — which is worse than showing nothing.
  if (Math.abs(Date.parse(chat[i].ts) - t) > NEAR_S * 1000) return null;
  const around = chat.slice(Math.max(0, i - SAY_BEFORE), i + SAY_AFTER + 1);
  if (!around.length) return null;

  return (
    <div className="space-y-1">
      {around.map((m) => {
        const ours = m.username === BOT_NAME;
        return (
          <p key={m.id} className="flex gap-2 text-body leading-snug">
            <span className="w-28 shrink-0 truncate font-semibold"
              style={{ color: ours ? 'var(--kick-green)' : 'var(--text-secondary)' }}>
              {m.username}
            </span>
            <span className="min-w-0 flex-1"
              style={{ color: ours ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {/* Emote tokens are for the chat pane's renderer; here they are noise. */}
              {m.text.replace(/\[emote:\d+:([^\]]+)\]/g, '$1')}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export default function ResultDetail({ r, h, bandit, chat }: {
  r: LedgerRow;
  h: History;
  bandit: BanditFrame | null;
  /** Every message this tab has seen. Empty is fine — the transcript just does not render. */
  chat: ChatFrame[];
}) {
  const [nerd, setNerd] = useState(false);
  const tint = VERDICT_COLOR[labelFor(r)];
  const caveat = whyUnattributable(r);
  const why = whyThisArm(bandit, r.state, r.arm);
  const sent = r.outcome === 'fired';
  const voted = Object.values(r.votes).some((n) => n > 0);
  const at = h.elapsed[r.tick] != null ? clock(Math.max(0, h.elapsed[r.tick] - WINDOW_S)) : null;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
      {/* The line in full — the row above it is truncated, which is the main reason to open
          one at all. No lift figure here: the row is still on screen, showing it. */}
      {r.action?.body ? (
        <p className="text-body leading-snug text-[var(--text-primary)]">“{r.action.body}”</p>
      ) : (
        <p className="text-body italic text-[var(--text-muted)]">no line recorded</p>
      )}
      <p className="mt-1 text-label text-[var(--text-muted)]">
        {[
          BOT_NAME,
          at,
          ARM_LABEL[r.arm],
          sent ? ORIGIN_LABEL[r.origin]
            : r.outcome === 'send_failed' ? 'the send failed' : 'never went out',
        ].filter(Boolean).join(' · ')}
      </p>

      {sent && (
        <div className={`mt-2 grid gap-2 ${voted ? 'sm:grid-cols-2' : ''}`}>
          <Tile label="CHAT WHILE IT RAN">
            <WindowChart h={h} closeIdx={r.tick} tint={tint} />
          </Tile>
          {voted && (
            <Tile label="HOW CHAT ANSWERED">
              <Votes votes={r.votes} options={r.action?.options} />
            </Tile>
          )}
        </div>
      )}

      {r.action?.ts && chat.length > 0 && (
        <div className="mt-2">
          <Tile label="WHAT CHAT WAS SAYING">
            <Transcript chat={chat} at={r.action.ts} />
          </Tile>
        </div>
      )}

      <div className="mt-2 flex items-baseline gap-2 text-label text-[var(--text-muted)]">
        {caveat ? (
          <span className="min-w-0 truncate text-[var(--warn)]" title={caveat}>{caveat}</span>
        ) : (
          <span className="min-w-0 truncate"
            title="Chat drifts on its own. The lift is what is left after the average drift of comparable quiet windows is subtracted from this one.">
            measured against {r.controls} quiet {r.controls === 1 ? 'window' : 'windows'} like this one
          </span>
        )}
        {why && (
          <span className="min-w-0 shrink truncate" title={why.text}>
            · {why.mode === 'explore' ? 'was exploring' : 'was backing the leader'}
          </span>
        )}
        <button onClick={() => setNerd((v) => !v)}
          className="ml-auto flex shrink-0 items-center gap-0.5 hover:text-[var(--text-secondary)]">
          <ChevronRight size={10}
            style={{ transform: nerd ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
          numbers
        </button>
      </div>

      {nerd && (
        <dl className="tnum mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[var(--border)] pt-1.5 text-label sm:grid-cols-4">
          {([
            ['matched lift', points(r.engagement_delta), 'against comparable quiet windows'],
            ['naive lift', points(r.lift_naive), 'before/after only, biased by drift'],
            ['reward', r.reward.toFixed(3), 'the [0,1] squash that updates the posterior'],
            ['controls', String(r.controls), 'clean same-state quiet windows averaged'],
            ['propensity', r.action ? r.action.propensity.toFixed(2) : '—',
              'chance the sampler picks this arm here again'],
            ['origin', r.origin, 'autonomous trials are the causal cohort'],
            ['outcome', r.outcome, 'how the window terminated'],
            ['standing', why?.text ?? '—', 'where this tactic sits in this state now'],
          ] as const).map(([k, v, hint]) => (
            <div key={k} title={hint} className="min-w-0">
              <dt className="text-[var(--text-muted)]">{k}</dt>
              <dd className="truncate text-[var(--text-secondary)]">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
