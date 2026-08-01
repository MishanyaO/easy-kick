import { Settings, Smile, UserCircle2 } from 'lucide-react';
import { VENDORED_EMOTES as EMOTES, emoteSrc } from './emotes';

/** Kick's chat composer. Static — the input does not send anything. */
export default function ChatComposer() {
  return (
    <div className="shrink-0 border-t border-[var(--border)] px-3 pb-2.5 pt-2">
      <div className="mb-2 flex items-center justify-between gap-1">
        {EMOTES.map((e) => (
          <button
            key={e.id}
            aria-label={`Insert ${e.name}`}
            title={e.name}
            className="flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-elevated)]"
          >
            <img
              src={emoteSrc(e.id)}
              alt={e.name}
              draggable={false}
              className="size-[22px] object-contain"
            />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-2">
        <UserCircle2 size={15} className="shrink-0 text-[var(--text-secondary)]" />
        <input
          disabled
          placeholder="Send a message"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--text-secondary)]"
        />
        <Smile size={15} className="shrink-0 text-[var(--text-secondary)]" />
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <Settings size={15} className="text-[var(--text-secondary)]" />
        <button className="rounded bg-[var(--kick-green)] px-3 py-1 text-sm font-semibold text-[var(--on-primary)]">
          Chat
        </button>
      </div>
    </div>
  );
}
