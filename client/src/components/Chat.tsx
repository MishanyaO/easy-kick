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
import type { ChatFrame, PollFrame, Prediction } from '../types';
import { asPrediction } from '../types';
import { BOT_NAME, isAward, type ClosedPoll } from '../useGambit';
import { emoteSrc } from '../kick/emotes';
import { LevelBadge, identity } from '../kick/badges';

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

/**
 * A prediction, in the poll banner's shape minus everything we cannot honestly show.
 *
 * `/prediction …` is a command Kick consumes: no viewer sees that text, the staking happens
 * in Kick's own widget, and no vote ever comes back to us (which is why `prediction` pays no
 * XP — see `ARM_XP`). So there are no bars and no tally here, deliberately — the outcomes
 * render as the same unclickable chips a poll uses, and the footer says where the answer
 * actually is instead of printing a zero that would read as "nobody backed it".
 */
function PredictionBanner({ prediction, pinned = false }: {
  prediction: Prediction;
  /** In the pinned slot above the feed, rather than inline as a message row. */
  pinned?: boolean;
}) {
  return (
    <div
      className={
        pinned
          ? 'shrink-0 border-b border-[var(--border)] px-2 py-1.5'
          : 'mx-2 my-1 rounded-md border-l-2 px-2 py-1.5 lg:mx-3'
      }
      style={{
        background: 'rgba(83,252,24,0.06)',
        ...(pinned ? {} : { borderColor: 'var(--kick-green)' }),
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="rounded px-1 py-px text-[9px] font-bold tracking-wider text-black"
          style={{ background: 'var(--kick-green)' }}
        >
          GAMBIT
        </span>
        <span className="text-[9px] uppercase tracking-widest text-[var(--kick-green)]">
          prediction open
        </span>
      </div>
      <p className="mt-1 text-[12px] font-medium leading-snug text-[var(--text-primary)]">
        {prediction.question}
      </p>

      {prediction.outcomes.length > 0 && (
        <div className="mt-1.5 flex gap-1.5">
          {prediction.outcomes.map((outcome) => (
            <span
              key={outcome}
              className="flex-1 truncate rounded-sm border border-[var(--border)] px-2 py-1 text-[12px] font-semibold text-[var(--text-primary)]"
            >
              {outcome}
            </span>
          ))}
        </div>
      )}

      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        viewers stake Channel Points in Kick's widget · we never see who backed which side
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

/** Kick's VIP crown, used verbatim from the chatroom markup. */
function VipBadge() {
  return (
    <span className="inline-flex size-[1.35em] shrink-0 items-center" title="VIP">
      <svg viewBox="0 0 32 32" fill="none" className="size-full" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#ek-vip-clip)">
          <path d="M30 0C31.1046 0 32 0.895431 32 2V30C32 31.1046 31.1046 32 30 32H2C0.895431 32 0 31.1046 0 30V2C0 0.895431 0.895431 4.10637e-08 2 0H30ZM15.9648 5C15.7748 5.00005 15.588 5.05204 15.4238 5.15039C15.2596 5.24878 15.124 5.39057 15.0303 5.56055L9.82812 15.0176L3.55078 11.8906C3.36913 11.7985 3.16534 11.7607 2.96387 11.7822C2.76241 11.8038 2.57048 11.8842 2.41113 12.0127C2.25235 12.1408 2.13185 12.3126 2.06348 12.5078C1.99511 12.7031 1.98143 12.9144 2.02441 13.1172L4.58301 25.127C4.63544 25.3782 4.77165 25.6034 4.96777 25.7627C5.16376 25.9217 5.40762 26.0056 5.65723 26H26.251C26.5009 26.0057 26.7453 25.9219 26.9414 25.7627C27.1376 25.6034 27.2737 25.3782 27.3262 25.127L29.9697 13.1172C30.0187 12.9103 30.0086 12.6932 29.9404 12.4922C29.8722 12.2912 29.7485 12.1151 29.585 11.9844C29.4215 11.8537 29.2249 11.7743 29.0186 11.7559C28.8122 11.7374 28.6049 11.7802 28.4219 11.8799L22.1025 15.0283L16.9004 5.56055C16.8066 5.39054 16.6701 5.24878 16.5059 5.15039C16.3416 5.05207 16.1549 5 15.9648 5Z" fill="url(#ek-vip-a)" />
          <path d="M30 0C31.1046 0 32 0.895431 32 2V30C32 31.1046 31.1046 32 30 32H2C0.895431 32 0 31.1046 0 30V2C0 0.895431 0.895431 4.10637e-08 2 0H30ZM15.9648 5C15.7748 5.00005 15.588 5.05204 15.4238 5.15039C15.2596 5.24878 15.124 5.39057 15.0303 5.56055L9.82812 15.0176L3.55078 11.8906C3.36913 11.7985 3.16534 11.7607 2.96387 11.7822C2.76241 11.8038 2.57048 11.8842 2.41113 12.0127C2.25235 12.1408 2.13185 12.3126 2.06348 12.5078C1.99511 12.7031 1.98143 12.9144 2.02441 13.1172L4.58301 25.127C4.63544 25.3782 4.77165 25.6034 4.96777 25.7627C5.16376 25.9217 5.40762 26.0056 5.65723 26H26.251C26.5009 26.0057 26.7453 25.9219 26.9414 25.7627C27.1376 25.6034 27.2737 25.3782 27.3262 25.127L29.9697 13.1172C30.0187 12.9103 30.0086 12.6932 29.9404 12.4922C29.8722 12.2912 29.7485 12.1151 29.585 11.9844C29.4215 11.8537 29.2249 11.7743 29.0186 11.7559C28.8122 11.7374 28.6049 11.7802 28.4219 11.8799L22.1025 15.0283L16.9004 5.56055C16.8066 5.39054 16.6701 5.24878 16.5059 5.15039C16.3416 5.05207 16.1549 5 15.9648 5Z" fill="url(#ek-vip-b)" />
        </g>
        <defs>
          <linearGradient id="ek-vip-a" x1="18.8102" y1="-12.7222" x2="2.88536" y2="39.1063" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6A4A" />
            <stop offset="1" stopColor="#C70C00" />
          </linearGradient>
          <linearGradient id="ek-vip-b" x1="15.7467" y1="-4.75575" x2="16.321" y2="39.0672" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFC900" />
            <stop offset="0.99" stopColor="#FF9500" />
          </linearGradient>
          <clipPath id="ek-vip-clip"><rect width="32" height="32" fill="white" /></clipPath>
        </defs>
      </svg>
    </span>
  );
}

/** The channel's kettlebell sub badge, vendored into public/badges. */
function SubBadge() {
  return (
    <span className="inline-flex size-[1.35em] shrink-0 items-center" title="Subscriber">
      <img className="size-full" alt="Subscriber" src="/badges/subscriber.png" draggable={false} />
    </span>
  );
}

/** Kick's moderator shield, used verbatim from the chatroom markup. */
function ModBadge() {
  return (
    <span className="inline-flex size-[1.35em] shrink-0 items-center" title="Moderator">
      <svg viewBox="0 0 32 32" fill="none" className="size-full" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#ek-mod-clip)">
          <path d="M30 0C31.1046 0 32 0.895431 32 2V30C32 31.1046 31.1046 32 30 32H2C0.895431 32 0 31.1046 0 30V2C0 0.895431 0.895431 0 2 0H30ZM16.2197 2.99316C15.8292 2.60266 15.1962 2.60265 14.8057 2.99316L8.36328 9.43555C7.97294 9.82608 7.97284 10.4591 8.36328 10.8496L10.0918 12.5781C10.4823 12.9686 11.1153 12.9685 11.5059 12.5781L11.585 12.499L13.9414 14.8564L3.57129 25.2275C2.70357 26.0954 2.7035 27.5023 3.57129 28.3701C4.43911 29.2376 5.84612 29.2377 6.71387 28.3701L17.084 17.999L19.4414 20.3564L19.3633 20.4346C18.9728 20.8251 18.9728 21.4581 19.3633 21.8486L21.0918 23.5771C21.4823 23.9676 22.1154 23.9676 22.5059 23.5771L28.9482 17.1348C29.3386 16.7443 29.3386 16.1112 28.9482 15.7207L27.2197 13.9922C26.8293 13.6017 26.1962 13.6018 25.8057 13.9922L25.7266 14.0703L23.3701 11.7139C24.2377 10.8461 24.2376 9.4391 23.3701 8.57129C22.5023 7.7035 21.0954 7.70357 20.2275 8.57129L17.8701 6.21387L17.9482 6.13574C18.3388 5.74522 18.3388 5.11221 17.9482 4.72168L16.2197 2.99316Z" fill="url(#ek-mod-a)" />
          <path d="M30 0C31.1046 0 32 0.895431 32 2V30C32 31.1046 31.1046 32 30 32H2C0.895431 32 0 31.1046 0 30V2C0 0.895431 0.895431 0 2 0H30ZM16.2197 2.99316C15.8292 2.60266 15.1962 2.60265 14.8057 2.99316L8.36328 9.43555C7.97294 9.82608 7.97284 10.4591 8.36328 10.8496L10.0918 12.5781C10.4823 12.9686 11.1153 12.9685 11.5059 12.5781L11.585 12.499L13.9414 14.8564L3.57129 25.2275C2.70357 26.0954 2.7035 27.5023 3.57129 28.3701C4.43911 29.2376 5.84612 29.2377 6.71387 28.3701L17.084 17.999L19.4414 20.3564L19.3633 20.4346C18.9728 20.8251 18.9728 21.4581 19.3633 21.8486L21.0918 23.5771C21.4823 23.9676 22.1154 23.9676 22.5059 23.5771L28.9482 17.1348C29.3386 16.7443 29.3386 16.1112 28.9482 15.7207L27.2197 13.9922C26.8293 13.6017 26.1962 13.6018 25.8057 13.9922L25.7266 14.0703L23.3701 11.7139C24.2377 10.8461 24.2376 9.4391 23.3701 8.57129C22.5023 7.7035 21.0954 7.70357 20.2275 8.57129L17.8701 6.21387L17.9482 6.13574C18.3388 5.74522 18.3388 5.11221 17.9482 4.72168L16.2197 2.99316Z" fill="url(#ek-mod-b)" />
          <path d="M30 0C31.1046 0 32 0.895431 32 2V30C32 31.1046 31.1046 32 30 32H2C0.895431 32 0 31.1046 0 30V2C0 0.895431 0.895431 0 2 0H30ZM16.2197 2.99316C15.8292 2.60266 15.1962 2.60265 14.8057 2.99316L8.36328 9.43555C7.97294 9.82608 7.97284 10.4591 8.36328 10.8496L10.0918 12.5781C10.4823 12.9686 11.1153 12.9685 11.5059 12.5781L11.585 12.499L13.9414 14.8564L3.57129 25.2275C2.70357 26.0954 2.7035 27.5023 3.57129 28.3701C4.43911 29.2376 5.84612 29.2377 6.71387 28.3701L17.084 17.999L19.4414 20.3564L19.3633 20.4346C18.9728 20.8251 18.9728 21.4581 19.3633 21.8486L21.0918 23.5771C21.4823 23.9676 22.1154 23.9676 22.5059 23.5771L28.9482 17.1348C29.3386 16.7443 29.3386 16.1112 28.9482 15.7207L27.2197 13.9922C26.8293 13.6017 26.1962 13.6018 25.8057 13.9922L25.7266 14.0703L23.3701 11.7139C24.2377 10.8461 24.2376 9.4391 23.3701 8.57129C22.5023 7.7035 21.0954 7.70357 20.2275 8.57129L17.8701 6.21387L17.9482 6.13574C18.3388 5.74522 18.3388 5.11221 17.9482 4.72168L16.2197 2.99316Z" fill="url(#ek-mod-c)" />
        </g>
        <defs>
          <linearGradient id="ek-mod-a" x1="18.8102" y1="-12.7222" x2="2.88536" y2="39.1063" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF6A4A" />
            <stop offset="1" stopColor="#C70C00" />
          </linearGradient>
          <linearGradient id="ek-mod-b" x1="15.7467" y1="-4.75575" x2="16.321" y2="39.0672" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFC900" />
            <stop offset="0.99" stopColor="#FF9500" />
          </linearGradient>
          <linearGradient id="ek-mod-c" x1="-14.9543" y1="46.9544" x2="32.0001" y2="-0.000509222" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0095FF" />
            <stop offset="0.99" stopColor="#00C7FF" />
          </linearGradient>
          <clipPath id="ek-mod-clip"><rect width="32" height="32" fill="white" /></clipPath>
        </defs>
      </svg>
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

/**
 * A participation award, in the shape of a system message rather than a chat line.
 *
 * Deliberately distinct from the GAMBIT intervention block above: an intervention is us
 * asking chat for something, an award is chat being thanked for giving it. Rendering both
 * identically would make the reward read as one more thing the bot wants.
 *
 * Centred, full-bleed and quiet — the visual language every chat client uses for "this is
 * the room talking about itself", not "someone said this".
 */
function AwardRow({ m }: { m: ChatFrame }) {
  return (
    <div className="px-2 py-[3px] lg:px-3">
      <div
        className="rounded-md border px-2.5 py-1.5 text-center"
        style={{
          borderColor: 'rgba(83,252,24,0.35)',
          background:
            'linear-gradient(90deg, rgba(83,252,24,0.04), rgba(83,252,24,0.12), rgba(83,252,24,0.04))',
        }}
      >
        <p className="text-[12.5px] font-semibold leading-snug text-[var(--kick-green)]">
          {m.text}
        </p>
      </div>
    </div>
  );
}

/** One message in Kick's chatroom style. Shared with the Insights transcript snippet. */
export function ChatMessageRow({ m, isBot }: { m: ChatFrame; isBot: boolean }) {
  if (isAward(m)) return <AwardRow m={m} />;

  if (isBot) {
    // A prediction is not a line the bot said, so it does not get the "posted to chat" row.
    const prediction = asPrediction(m.text);
    if (prediction) return <PredictionBanner prediction={prediction} />;

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

  // Badge order mirrors Kick: role, then sub, then level.
  const { level, role, sub } = identity(m.username);
  const isMod = m.is_mod || role === 'mod';
  const isVip = role === 'vip' && !isMod;
  const isSub = m.is_sub || sub;
  const hasBadge = isMod || isVip || isSub || level !== null;

  return (
    <div className="group relative px-2 lg:px-3">
      <div className="w-full min-w-0 break-words rounded-lg px-2 py-[4px] text-[14px] transition-colors group-hover:bg-white/[0.04]">
        <span className="inline-flex min-w-0 flex-nowrap items-baseline">
          {hasBadge && (
            <span className="flex items-center gap-1 self-center pr-1">
              {isMod && <ModBadge />}
              {isVip && <VipBadge />}
              {isSub && <SubBadge />}
              {level !== null && <LevelBadge level={level} />}
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

  // The pinned slot holds whatever our last move was — a prediction command has to become the
  // widget it opens there too, or the one line the streamer is meant to point at is the one
  // place our slash syntax is still on screen.
  const lastBotPrediction = asPrediction(lastBot?.text);

  const hasNew = frozen !== null && messages[messages.length - 1]?.id !== frozen[frozen.length - 1]?.id;
  // Interventions, not awards. This counter is the ACT step's tally — "our line reached the
  // same chat everyone else is in" — and an award is a receipt for one of those, so counting
  // both would double every fire and overstate how often we interrupt.
  const botLines = messages.filter((m) => m.username === BOT_NAME && !isAward(m)).length;

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
      ) : lastBotPrediction ? (
        <PredictionBanner prediction={lastBotPrediction} pinned />
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
          view.map((m) => (
            <ChatMessageRow key={m.id} m={m} isBot={m.username === BOT_NAME} />
          ))
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
