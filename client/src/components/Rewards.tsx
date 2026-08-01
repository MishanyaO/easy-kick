// The participation ledger: one column per intervention, newest first.
//
// The award lines themselves are posted into chat, where they scroll away within seconds —
// which is the right place for the encouragement (it is aimed at the room) and the wrong
// place for the record (that is aimed at the streamer). This is the record, and it is
// read-only: the switch that stops rewards is a rail, and rails live in Channel Actions
// with the rest of them rather than being scattered across whatever screen mentions them.
//
// Columns rather than one merged leaderboard, because the question a streamer actually has
// is "who turns up for what?" — and a single ranked table answers a different, duller one
// ("who talks most"), which the top of it would have told you anyway. Side by side, the same
// name appearing in three columns is visible at a glance, and so is a poll that only pulled
// two people while the rally next to it pulled nineteen.
import { useState } from 'react';
import { ARM_LABEL, ARM_XP, type Arm, type AwardFrame } from '../types';
import { LevelBadge, identity } from '../kick/badges';
import type { GambitState } from '../useGambit';

/**
 * The viewer's Kick level emblem — the same badge they wear in the chat pane, from the same
 * `identity()`, so the same person looks like the same person on both surfaces.
 *
 * This is their *chat* level, not their participation tier. An earlier pass mapped our four
 * tiers onto four of these emblems and that was wrong: the art has a level number printed
 * inside it, so the badge said "8" while the XP column said 20, and the identical glyph
 * meant a real Kick level one panel away. Showing the level as the level is the version
 * where the number on the badge is true.
 *
 * The tier still exists — it drives the promotion line in chat — and lives in the XP
 * tooltip rather than as a second emblem competing with this one.
 *
 * Kick shows a level on only some viewers, so the slot is fixed-width and often empty: names
 * have to line up down the column whether or not the person above has a badge.
 */
function ChatterBadge({ user }: { user: string }) {
  const { level } = identity(user);
  return (
    <span className="flex w-4 shrink-0 justify-center text-[11px]">
      {level !== null && <LevelBadge level={level} />}
    </span>
  );
}

/** Interventions shown side by side before "Show all". Enough to see a pattern across a
 *  stretch of the session without the columns becoming too narrow to read a username in. */
const COLUMNS = 6;
/**
 * Names per column before "Show all".
 *
 * A rally can activate twenty viewers and the twentieth name carries no information — but
 * "carries no information" is a claim about the summary, not about the data, so the rest is
 * one click away rather than gone.
 */
const PER_COLUMN = 5;

/** Arms that pay out, cheapest effort first, for the rate card. */
const PAYING_ARMS = (Object.keys(ARM_XP) as Arm[]).sort(
  (a, b) => (ARM_XP[a] ?? 0) - (ARM_XP[b] ?? 0),
);

export default function Rewards({ s }: { s: GambitState }) {
  const [all, setAll] = useState(false);
  const shown = all ? s.awards : s.awards.slice(0, COLUMNS);
  const more = s.awards.length - shown.length;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-body text-[var(--text-muted)]">
        <span>
          <span className="tnum text-[var(--text-primary)]">{s.ranked}</span> viewers have
          earned something this session
        </span>
        <span>
          <span className="tnum text-[var(--text-primary)]">{s.awards.length}</span> payouts
        </span>
        {/* The rate card. Without it a column of XP totals has no unit — you cannot tell
            whether 30 XP is three quizzes or six rallies. */}
        <span className="ml-auto">
          {PAYING_ARMS.map((arm) => `${ARM_LABEL[arm]} +${ARM_XP[arm]}`).join(' · ')}
        </span>
      </div>

      {s.awards.length === 0 ? (
        <p className="rounded-lg border border-[var(--border)] px-3 py-8 text-center text-body text-[var(--text-muted)]">
          Nobody has taken part in an intervention yet. XP is paid out when a poll, quiz or
          emote rally closes — predictions run inside Kick's own widget, so we cannot see who
          backed which side and they pay nothing.
        </p>
      ) : (
        <>
          {/* Scrolls sideways rather than reflowing: these are meant to be read against each
              other, and a grid that wrapped to a second row would break the comparison.
              Expanded, it wraps instead — past a dozen columns a single strip is a worse
              way to see the session than a block of them. */}
          <div className={all ? '' : '-mx-1 overflow-x-auto px-1 pb-1'}>
            <div
              // `items-start` only when wrapped: a grid row is as tall as its tallest card,
              // so without it a three-person poll next to a thirteen-person rally renders as
              // a mostly empty box. In the single-row strip the opposite is true — equal
              // heights are what make it read as one band.
              className={all ? 'grid items-start gap-2' : 'flex gap-2'}
              style={
                all
                  ? { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }
                  : { minWidth: `${shown.length * 165}px` }
              }
            >
              {shown.map((award) => (
                <Column key={award.action_id} award={award} expanded={all} />
              ))}
            </div>
          </div>

          {(more > 0 || all) && (
            <button
              onClick={() => setAll((v) => !v)}
              className="w-full rounded-lg border border-[var(--border)] py-2 text-body font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--kick-green)] hover:text-[var(--kick-green)]"
            >
              {all ? 'Show less' : `Show all ${s.awards.length} payouts`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** One intervention: what it was, what it paid, and who took part — quickest first. */
function Column({ award, expanded }: { award: AwardFrame; expanded: boolean }) {
  const people = expanded ? award.awarded : award.awarded.slice(0, PER_COLUMN);
  const hidden = award.awarded.length - people.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <div
        className="border-b border-[var(--border)] px-2.5 py-2"
        style={{ background: 'rgba(83,252,24,0.04)' }}
      >
        <div className="flex items-baseline gap-1.5">
          <p className="min-w-0 flex-1 truncate text-body font-semibold text-[var(--text-primary)]">
            {ARM_LABEL[award.arm]}
          </p>
          <span
            className="tnum shrink-0 rounded px-1.5 py-px text-[10px] font-bold text-black"
            style={{ background: 'var(--kick-green)' }}
          >
            +{award.xp}
          </span>
        </div>
        {/* Doubles as the legend for the list below. A card carries two different XP
            quantities — what this window paid (the pill above, the same for everyone) and
            where it left each viewer (the column of numbers) — and with only the first of
            them labelled the second reads as a payout that inexplicably varies per person. */}
        <p className="mt-0.5 flex items-baseline justify-between gap-2 text-label text-[var(--text-muted)]">
          <span>
            <span className="tnum">{award.awarded.length}</span> took part
          </span>
          <span className="shrink-0 tracking-[0.1em]">TOTAL</span>
        </p>
      </div>

      <ol className="flex-1 py-1">
        {people.map((person, i) => (
          <li
            key={person.user}
            className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-white/[0.03]"
          >
            {/* Position in the window, not a rank: everyone here earned the same amount, so
                the only thing an order can mean is who got there first. */}
            <span className="tnum w-4 shrink-0 text-right text-[10px] text-[var(--text-muted)]">
              {i + 1}
            </span>
            <ChatterBadge user={person.user} />
            <span className="min-w-0 flex-1 truncate text-body text-[var(--text-secondary)]">
              {person.user}
            </span>
            {/* Their session total, not this award — the header already says what it paid,
                and the useful thing about a name here is whether it is a regular. */}
            <span
              className="tnum shrink-0 text-label text-[var(--text-muted)]"
              title={`${person.user} is on ${person.xp} XP this session — ${person.tier}. This ${ARM_LABEL[award.arm].toLowerCase()} paid them +${award.xp}.`}
            >
              {person.xp}
            </span>
          </li>
        ))}
      </ol>

      {hidden > 0 && (
        <p className="border-t border-[var(--border)] px-2.5 py-1 text-label text-[var(--text-muted)]">
          +{hidden} more
        </p>
      )}
    </div>
  );
}
