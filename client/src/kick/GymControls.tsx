import { Pause, Play, Square } from 'lucide-react';
import { GYM_SPEEDS, type GymControlsState } from './useGymControls';

/**
 * Start / Pause / Stop plus the speed picker, in two shapes:
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

  const speeds = (
    <div className={`flex gap-0.5 rounded bg-[var(--bg-surface)] p-0.5 ${bar ? '' : 'w-full'}`}>
      {GYM_SPEEDS.map((sp) => (
        <button
          key={sp}
          onClick={() => changeSpeed(sp)}
          className={`rounded text-xs font-semibold transition-colors hover:text-white ${
            bar ? 'px-2 py-0.5' : 'flex-1 py-1'
          } ${speed === sp ? 'bg-[var(--bg-elevated)] text-white' : 'text-[var(--text-muted)]'}`}
        >
          {sp}x
        </button>
      ))}
    </div>
  );

  const buttons = (
    <div className="flex gap-2">
      <button
        onClick={on ? pause : start}
        className={`flex h-7 items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors ${
          bar ? 'px-3' : 'flex-1'
        } ${
          on
            ? 'bg-[var(--bg-surface)] text-white hover:bg-[var(--bg-elevated)]'
            : 'bg-[var(--kick-green)] text-[var(--on-primary)] hover:bg-[var(--kick-green-dim)]'
        }`}
      >
        {on ? <Pause size={12} /> : <Play size={12} />}
        {on ? 'Pause' : status === 'paused' ? 'Resume' : 'Start gym'}
      </button>
      {status !== 'idle' && (
        <button
          onClick={stop}
          className="flex h-7 items-center justify-center gap-1.5 rounded bg-[var(--bg-surface)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--bg-elevated)]"
        >
          <Square size={12} />
          Stop
        </button>
      )}
    </div>
  );

  const label = (
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--warn)]">
      <span
        className={`size-1.5 rounded-full ${on ? 'bg-[var(--kick-green)]' : 'bg-[var(--text-muted)]'}`}
      />
      Gym{status === 'paused' ? ' (paused)' : ''}
    </span>
  );

  if (bar) {
    return (
      <div className="flex items-center gap-2">
        {label}
        {speeds}
        {buttons}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      {label}
      {speeds}
      {buttons}
    </div>
  );
}
