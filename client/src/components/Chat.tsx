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
import type { ChatFrame } from '../types';
import { BOT_NAME } from '../useGambit';
import { ModerationIcon } from '../kick/icons';

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
          src={`https://files.kick.com/emotes/${m[1]}/fullsize`}
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

export default function Chat({ messages, lastBot, participation, viewers, frameless = false }: {
  messages: ChatFrame[];
  /** survives eviction from the chat window — see the note in useGambit */
  lastBot: ChatFrame | null;
  participation?: number;
  viewers?: number | null;
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

  const view = frozen ?? messages;

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
          or the ACT step leaves no trace the streamer can point at. */}
      {lastBot && (
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
