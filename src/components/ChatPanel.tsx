import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Gem, MessageCircle } from 'lucide-react';
import type { ChatEvent } from '../types';

const USER_COLORS = [
  '#e05d5d', '#e09a5d', '#e0c95d', '#8fd45d', '#5dd4a8', '#5db8e0',
  '#7d8fe0', '#a87de0', '#d47ec0', '#c0c7c9', '#e0b0a0', '#9ad47e',
];

export function userColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export default function ChatPanel({ messages, spike }: { messages: ChatEvent[]; spike: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      className="flex h-full flex-col rounded-xl border bg-[var(--bg-surface)] transition-colors duration-500"
      style={{ borderColor: spike ? 'var(--kick-green)' : 'var(--border)' }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span
          className="h-2 w-2 rounded-full transition-colors duration-300"
          style={{ background: spike ? 'var(--kick-green)' : 'var(--text-muted)' }}
        />
        <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">LIVE CHAT</span>
        <span className="ml-auto tnum text-xs text-[var(--text-muted)]">{messages.length}</span>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-2 py-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle size={20} className="text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">
              Connecting to chat…<br />messages will appear here.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded px-1.5 py-[3px] leading-snug hover:bg-[var(--bg-elevated)]"
            >
              {m.is_mod && <Shield size={11} className="mr-1 inline text-[var(--kick-green)]" aria-label="mod" />}
              {m.is_sub && <Gem size={11} className="mr-1 inline text-[var(--text-secondary)]" aria-label="subscriber" />}
              <span className="font-semibold" style={{ color: userColor(m.username) }}>
                {m.username}
              </span>
              <span className="text-[var(--text-muted)]">: </span>
              <span className="text-[var(--text-primary)]">{m.text}</span>
              {m.emotes.map((e, i) => (
                <span
                  key={i}
                  className="ml-1 inline-block rounded bg-[var(--bg-elevated)] px-1 py-px text-[10px] font-bold text-[var(--kick-green)]"
                >
                  {e}
                </span>
              ))}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
