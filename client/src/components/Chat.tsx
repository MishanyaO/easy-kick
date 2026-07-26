// The chat column. This is the ACT step's only proof: the streamer (and a judge) has to
// see our line land in the same stream everyone else is talking in.
//
// `gambit` is the bot's username, and `engagement.py` already excludes it from
// participation — our own line cannot inflate the number it is judged on.
import { useEffect, useRef, useState } from 'react';
import type { ChatFrame } from '../types';
import { BOT_NAME } from '../useGambit';

/** Deterministic per-user colour, so the same chatter keeps the same one. */
function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function Row({ m, isBot }: { m: ChatFrame; isBot: boolean }) {
  if (isBot) {
    return (
      <div className="my-1.5 rounded-md border-l-2 px-2 py-1.5"
        style={{ borderColor: 'var(--kick-green)', background: 'rgba(83,252,24,0.07)' }}>
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1 py-px text-[9px] font-bold tracking-wider text-black"
            style={{ background: 'var(--kick-green)' }}>
            GAMBIT
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">posted to chat</span>
        </div>
        <p className="mt-1 text-[12px] font-medium leading-snug text-[var(--text-primary)]">
          {m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="px-1 py-[3px] text-[12px] leading-snug">
      <span className="font-semibold" style={{ color: `hsl(${hue(m.username)} 72% 64%)` }}>
        {m.username}
      </span>
      {m.is_sub && <span className="ml-1 text-[9px] text-[var(--kick-green)]">SUB</span>}
      <span className="text-[var(--text-secondary)]">: {m.text}</span>
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

  useEffect(() => {
    if (stuck && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, stuck]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

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

      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {messages.length === 0 ? (
          <p className="px-2 py-4 text-[11px] text-[var(--text-muted)]">
            Waiting for chat. Start the gym, or connect a live Kick channel.
          </p>
        ) : (
          messages.map((m) => (
            <Row key={m.id} m={m} isBot={m.username === BOT_NAME} />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 rounded-sm" style={{ background: 'var(--kick-green)' }} />
        <span>{botLines} line{botLines === 1 ? '' : 's'} from us on screen</span>
        {!stuck && (
          <button
            onClick={() => { setStuck(true); if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }}
            className="ml-auto rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-secondary)]">
            jump to now ↓
          </button>
        )}
      </div>
    </div>
  );
}
