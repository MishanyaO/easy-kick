// The chat column. This is the ACT step's only proof: the streamer (and a judge) has to
// see our line land in the same stream everyone else is talking in.
//
// `gambit` is the bot's username, and `engagement.py` already excludes it from
// participation — our own line cannot inflate the number it is judged on.
//
// Row anatomy and scroll behaviour are both Kick's, read off the live chatroom markup:
// badges → coloured username → `:` → content, at 14px with 4px between rows; and a feed
// that FREEZES while you are scrolled up, with a green "New messages" divider, rather
// than one that keeps growing under your cursor.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { ChatFrame, PollFrame } from '../types';
import { BOT_NAME, type ClosedPoll } from '../useGambit';
import { ModerationIcon } from '../kick/icons';
import { emoteSrc } from '../kick/emotes';

/**
 * The poll, pinned above the message list in the same slot the plain last-line banner
 * uses — while chat is voting (or just finished), that IS the bot's last line, and showing
 * both at once would just repeat the question with and without vote bars.
 *
 * Live while `closesInS` is a number (countdown, "chat is voting"); once the window closes
 * it keeps showing the final tally instead of collapsing back to plain text — a poll that
 * vanishes the instant it resolves reads as broken, not finished. It stays up until the
 * streamer dismisses it or a new bot line replaces it (see the `closedPoll`-clearing logic
 * in useGambit's reducer).
 *
 * Percentages are withheld below MIN_FOR_PCT. A poll that gets two votes is a real outcome
 * and must not look broken, but "100% yes" off two ballots is a lie told confidently; raw
 * counts are honest at any N, and the voter line says how thin the evidence is.
 *
 * Options render as buttons for the native-poll look Kick's own UI has — real votes are
 * counted from chat replies, not clicks, so these are unclickable, but a bar of plain text
 * reads as "a hack", and a poll widget with a live tally reads as "a real poll".
 */
const MIN_FOR_PCT = 10;

/** Messages the pane paints. Comfortably more than a tall panel can show, so scrollback
 *  still works, and bounded so a long session does not turn the pane into a DOM tree. */
const VISIBLE = 250;

function PollBanner({ poll, closesInS, onDismiss }: {
  poll: { question: string; options: string[]; votes: Record<string, number>; voters: number };
  /** Present while the window is still open; absent once it has closed. */
  closesInS?: number;
  /** Present once closed — lets the streamer clear the final tally by hand. */
  onDismiss?: () => void;
}) {
  const total = Object.values(poll.votes).reduce((a, n) => a + n, 0);
  const top = Math.max(1, ...Object.values(poll.votes));
  const live = closesInS !== undefined;
  return (
    <div
      className="shrink-0 border-b border-[var(--border)] px-2 py-1.5"
      style={{ background: 'rgba(83,252,24,0.06)' }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="rounded px-1 py-px text-[9px] font-bold tracking-wider text-black"
          style={{ background: 'var(--kick-green)' }}
        >
          GAMBIT
        </span>
        <span className="text-[9px] uppercase tracking-widest text-[var(--kick-green)]">
          {live ? 'chat is voting' : 'final tally'}
        </span>
        {live ? (
          <span className="tnum ml-auto text-[9px] text-[var(--text-muted)]">
            {closesInS.toFixed(0)}s left
          </span>
        ) : (
          onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss poll result"
              title="Dismiss"
              className="ml-auto flex size-4 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-white"
            >
              <X size={11} />
            </button>
          )
        )}
      </div>
      <p className="mt-1 text-[12px] font-medium leading-snug text-[var(--text-primary)]">
        {poll.question}
      </p>

      <div className="mt-1.5 flex gap-1.5">
        {poll.options.map((option) => {
          const n = poll.votes[option] ?? 0;
          const pctFill = Math.round((n / top) * 100);
          return (
            <button
              key={option}
              disabled
              className="relative flex-1 overflow-hidden rounded-sm border border-[var(--border)] px-2 py-1 text-left disabled:opacity-100"
            >
              <div
                className="absolute inset-y-0 left-0 bg-[var(--kick-green)]/20 transition-[width] duration-500"
                style={{ width: `${pctFill}%` }}
              />
              <span className="relative flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                  {option}
                </span>
                <span className="tnum shrink-0 text-[10px] text-[var(--text-secondary)]">
                  {n}
                  {total >= MIN_FOR_PCT && (
                    <span className="text-[var(--text-muted)]"> · {Math.round((n / total) * 100)}%</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        {total === 0
          ? live
            ? 'no votes yet — the prompt is in chat'
            : 'no one voted'
          : `${poll.voters} viewer${poll.voters === 1 ? '' : 's'} voted · one vote each` +
            (total < MIN_FOR_PCT ? ' · too few to read as a split' : '')}
      </p>
    </div>
  );
}

/** Deterministic per-user colour, so the same chatter keeps the same one. */
function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Kick's sub badge, lifted from the chatroom markup (the green `sub_gifter` variant). */
function SubBadge() {
  return (
    <span className="inline-flex size-[1.35em] shrink-0 items-center" title="Subscriber">
      <svg viewBox="0 0 32 32" fill="none" className="size-full" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 10H2V28H30V10Z" fill="#DDFED1" />
        <path d="M12 10H10L6 4H14L16 7L18 4H26L22 10H20V28H12V10Z" fill="#53FC18" />
      </svg>
    </span>
  );
}

function ModBadge() {
  return (
    <span
      className="inline-flex size-[1.35em] shrink-0 items-center text-[var(--kick-green)]"
      title="Moderator"
    >
      <ModerationIcon className="size-full" />
    </span>
  );
}

// Kick inlines emotes in the message body as `[emote:<id>:<NAME>]` and serves the image
// from files.kick.com — `payload.emotes` carries no names at all, which is the bug
// ticket 002 found. Parsing the body is therefore the only way to render them.
const EMOTE = /\[emote:(\d+):([^\]]*)\]/g;

function Body({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const m of text.matchAll(EMOTE)) {
    const at = m.index ?? 0;
    if (at > cursor) out.push(text.slice(cursor, at));
    out.push(
      <span
        key={`${at}-${m[1]}`}
        className="relative mx-px inline-block h-[1.2em] w-[2.15em] align-middle"
        data-emote-id={m[1]}
      >
        <img
          className="absolute left-0 top-1/2 h-[2.15em] w-[2.15em] -translate-y-1/2"
          src={emoteSrc(m[1])}
          alt={m[2]}
          title={m[2]}
          draggable={false}
        />
      </span>,
    );
    cursor = at + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

function Row({ m, isBot }: { m: ChatFrame; isBot: boolean }) {
  if (isBot) {
    return (
      <div
        className="mx-2 my-1 rounded-md border-l-2 px-2 py-1.5 lg:mx-3"
        style={{ borderColor: 'var(--kick-green)', background: 'rgba(83,252,24,0.07)' }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="rounded px-1 py-px text-[9px] font-bold tracking-wider text-black"
            style={{ background: 'var(--kick-green)' }}
          >
            GAMBIT
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">posted to chat</span>
        </div>
        <p className="mt-1 text-[13px] font-medium leading-snug text-[var(--text-primary)]">
          <Body text={m.text} />
        </p>
      </div>
    );
  }

  return (
    <div className="group relative px-2 lg:px-3">
      <div className="w-full min-w-0 break-words rounded-lg px-2 py-[4px] text-[14px] transition-colors group-hover:bg-white/[0.04]">
        <span className="inline-flex min-w-0 flex-nowrap items-baseline">
          {(m.is_sub || m.is_mod) && (
            <span className="flex items-center gap-1 self-center pr-1">
              {m.is_mod && <ModBadge />}
              {m.is_sub && <SubBadge />}
            </span>
          )}
          <span className="inline font-bold" style={{ color: `hsl(${hue(m.username)} 72% 64%)` }}>
            {m.username}
          </span>
        </span>
        <span className="inline-flex font-bold" aria-hidden="true">
          :&nbsp;
        </span>
        <span className="font-normal leading-[1.55] text-[var(--text-primary)]">
          <Body text={m.text} />
        </span>
      </div>
    </div>
  );
}

export default function Chat({
  messages, lastBot, participation, viewers, poll = null, closedPoll = null, onDismissPoll,
  frameless = false,
}: {
  messages: ChatFrame[];
  /** survives eviction from the chat window — see the note in useGambit */
  lastBot: ChatFrame | null;
  participation?: number;
  viewers?: number | null;
  /** The open chat_poll/quiz window, if any — takes over the pinned-banner slot. */
  poll?: PollFrame | null;
  /** The most recently closed poll/quiz, if the streamer hasn't dismissed it yet. */
  closedPoll?: ClosedPoll | null;
  onDismissPoll?: () => void;
  /** Drop the card frame and header — for hosts that supply their own chrome. */
  frameless?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  /** The list held still while the streamer reads back. Null means "follow the live feed". */
  const [frozen, setFrozen] = useState<ChatFrame[] | null>(null);
  // Mirrors `stuck` synchronously: the pin below runs before the state update lands, and
  // re-pinning after the streamer has started scrolling up is exactly the jump we are fixing.
  const following = useRef(true);

  // The tail, not the lot. A two-hour session accumulates a few thousand messages and every
  // one of them was a rendered row, which is a slower and slower pane for scrollback nobody
  // uses — a chat window is the last few minutes by definition. The full log stays in state
  // for the surfaces that do read back through it, like a result's transcript.
  const view = (frozen ?? messages).slice(-VISIBLE);

  // Pinning happens BEFORE paint and without animation, so the newest line simply is at the
  // bottom — a scripted smooth scroll runs after paint, which is visible as a jump on a
  // busy channel and never keeps up during a burst.
  useLayoutEffect(() => {
    const el = ref.current;
    if (following.current && el) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom === following.current) return;
    following.current = atBottom;
    setStuck(atBottom);
    // Snapshot on the way up so nothing shifts under the cursor; release on the way down.
    setFrozen(atBottom ? null : messages);
  };

  const jumpToNow = () => {
    following.current = true;
    setStuck(true);
    setFrozen(null);
  };

  const hasNew = frozen !== null && messages[messages.length - 1]?.id !== frozen[frozen.length - 1]?.id;
  const botLines = messages.filter((m) => m.username === BOT_NAME).length;

  return (
    <div
      className={
        frameless
          ? 'flex h-full flex-col overflow-hidden'
          : 'flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]'
      }
    >
      {!frameless && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[var(--kick-green)]" />
          <span className="text-[11px] font-bold tracking-[0.15em] text-[var(--text-secondary)]">
            LIVE CHAT
          </span>
          <span className="ml-auto tnum text-[10px] text-[var(--text-muted)]">
            {participation !== undefined && viewers
              ? `${(participation * 100).toFixed(1)}% of ${viewers} talking`
              : `${messages.length} msgs`}
          </span>
        </div>
      )}

      {/* Kick has no pinned messages (002), so our own line scrolls away within seconds —
          fast at 30x, but true on a busy live channel too. Pin the latest one ourselves,
          or the ACT step leaves no trace the streamer can point at. While a chat_poll/quiz
          window is open (or just closed and not yet dismissed), that last line IS the poll,
          so this slot shows the tally instead of repeating the question with no vote bars. */}
      {poll ? (
        <PollBanner poll={poll} closesInS={poll.closes_in_s} />
      ) : closedPoll ? (
        <PollBanner poll={closedPoll} onDismiss={onDismissPoll} />
      ) : lastBot && (
        <div className="shrink-0 border-b border-[var(--border)] px-2 py-1.5"
          style={{ background: 'rgba(83,252,24,0.06)' }}>
          <div className="flex items-center gap-1.5">
            <span className="rounded px-1 py-px text-[9px] font-bold tracking-wider text-black"
              style={{ background: 'var(--kick-green)' }}>
              GAMBIT
            </span>
            <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
              our last line · pinned here, not in Kick
            </span>
          </div>
          <p className="mt-1 text-[12px] font-medium leading-snug text-[var(--text-primary)]">
            {lastBot.text}
          </p>
        </div>
      )}

      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {view.length === 0 ? (
          <p className="px-4 py-4 text-[11px] text-[var(--text-muted)]">
            Waiting for chat. Start the gym, or connect a live Kick channel.
          </p>
        ) : (
          view.map((m) => <Row key={m.id} m={m} isBot={m.username === BOT_NAME} />)
        )}

        {/* Kick's divider: the frozen feed ends here, and everything past it arrived while
            the streamer was reading back. */}
        {hasNew && (
          <div className="flex w-full items-center gap-2 px-2 py-[5px] lg:px-3">
            <div className="h-px grow bg-[var(--kick-green)]" />
            <button onClick={jumpToNow} className="text-sm font-semibold text-[var(--kick-green)]">
              New messages
            </button>
            <div className="h-px grow bg-[var(--kick-green)]" />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 rounded-sm" style={{ background: 'var(--kick-green)' }} />
        <span>{botLines} line{botLines === 1 ? '' : 's'} from us on screen</span>
        {!stuck && (
          <button
            onClick={jumpToNow}
            className="ml-auto rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-secondary)]">
            jump to now ↓
          </button>
        )}
      </div>
    </div>
  );
}
