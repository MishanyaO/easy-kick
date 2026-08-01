import { Pause, Play, Square } from 'lucide-react';
import { GYM_SPEEDS, type GymControlsState } from './useGymControls';

/** The speed picker: one segmented control that stays the same height in either variant. */
function Segment<T extends string | number>({ items, value, render, onPick, bar }: {
  items: readonly T[];
  value: T;
  render: (v: T) => string;
  onPick: (v: T) => void;
  bar: boolean;
}) {
  return (
    <div className={`flex gap-0.5 rounded bg-[var(--bg-surface)] p-0.5 ${bar ? '' : 'w-full'}`}>
      {items.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`rounded text-[12px] font-semibold transition-colors ${
            bar ? 'px-2.5 py-1' : 'flex-1 py-1'
          } ${
            v === value
              ? 'bg-[var(--bg-elevated)] text-white'
              : 'text-[var(--text-muted)] hover:text-white'
          }`}
        >
          {render(v)}
        </button>
      ))}
    </div>
  );
}

/**
 * Start / Pause / Stop plus the world and speed pickers, in two shapes:
 *
 * - `panel` — stacked, for the Stream info panel's narrow column.
 * - `bar` — one row, for the Insights popout header.
 */
export default function GymControls({
  gym,
  variant = 'panel',
}: {
  gym: GymControlsState;
  variant?: 'panel' | 'bar';
}) {
  const { status, speed, changeSpeed, start, pause, stop } = gym;
  const on = status === 'running';
  const bar = variant === 'bar';

  // One width for both transport buttons. They swap labels as the run moves through its
  // states — Start / Pause / Resume / Stop — and a button that resizes under the cursor
  // between two clicks is the kind of thing you only notice on a projector.
  const btn = `${bar ? 'w-[88px]' : 'flex-1'} flex h-8 items-center justify-center gap-1.5 rounded text-[12px] font-semibold transition-colors`;

  const buttons = (
    <div className="flex gap-2">
      <button
        onClick={on ? pause : start}
        className={`${btn} ${
          on
            ? 'bg-[var(--bg-surface)] text-white hover:bg-[var(--bg-elevated)]'
            : 'bg-[var(--kick-green)] text-[var(--on-primary)] hover:bg-[var(--kick-green-dim)]'
        }`}
      >
        {on ? <Pause size={13} /> : <Play size={13} />}
        {on ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
      </button>
      {status !== 'idle' && (
        <button
          onClick={stop}
          className={`${btn} bg-[var(--bg-surface)] text-white hover:bg-[var(--bg-elevated)]`}
        >
          <Square size={12} />
          Stop
        </button>
      )}
    </div>
  );

  const label = (
    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--warn)]">
      <span
        className={`size-1.5 rounded-full ${on ? 'bg-[var(--kick-green)]' : 'bg-[var(--text-muted)]'}`}
      />
      Simulator{status === 'paused' ? ' (paused)' : ''}
    </span>
  );

  // Same four pieces in the same order either way — only how they stack differs.
  return (
    <div className={bar
      ? 'flex items-center gap-2'
      : 'mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3'}>
      {label}
      <Segment items={GYM_SPEEDS} value={speed} render={(sp) => `${sp}x`} onPick={changeSpeed}
        bar={bar} />
      {buttons}
    </div>
  );
}
