import { motion } from 'framer-motion';
import { Shield, Gem } from 'lucide-react';
import type { ChatEvent } from '../../types';
import { userColor } from './userColor';

/** One chat row: mod/sub badges, coloured username, text, emote chips. */
export default function ChatMessage({ m }: { m: ChatEvent }) {
  return (
    <motion.div
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
  );
}
