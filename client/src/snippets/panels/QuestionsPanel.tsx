import type { Question } from '../../types';

/** Repeated questions from chat — the things worth answering out loud. */
export default function QuestionsPanel({ questions }: { questions: Question[] }) {
  if (questions.length === 0) {
    return <p className="text-xs text-[var(--text-muted)]">No repeated questions right now.</p>;
  }
  return (
    <div className="space-y-1.5">
      {questions.map((q) => (
        <div key={q.id} className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-[var(--text-primary)]">“{q.text}”</span>
          <span className="tnum shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warn)]">
            asked {q.count}×
          </span>
        </div>
      ))}
    </div>
  );
}
