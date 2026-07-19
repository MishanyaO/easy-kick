/** Topic chips + top emotes: what chat is talking about right now. */
export default function TopicsPanel({ topics, emotes }: { topics: string[]; emotes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((t) => (
        <span
          key={t}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]"
        >
          {t}
        </span>
      ))}
      {emotes.map((e) => (
        <span
          key={e}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-bold text-[var(--kick-green)]"
        >
          {e}
        </span>
      ))}
    </div>
  );
}
