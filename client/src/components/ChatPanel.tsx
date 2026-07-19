import { MessageCircle } from 'lucide-react';
import type { ChatEvent } from '../types';
import { useAutoScroll } from '../snippets/hooks/useAutoScroll';
import ChatMessage from '../snippets/chat/ChatMessage';

export default function ChatPanel({ messages, spike }: { messages: ChatEvent[]; spike: boolean }) {
  const [scrollRef, onScroll] = useAutoScroll<HTMLDivElement>(messages.length);

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
          messages.map((m) => <ChatMessage key={m.id} m={m} />)
        )}
      </div>
    </div>
  );
}
