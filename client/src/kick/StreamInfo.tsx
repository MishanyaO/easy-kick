import { ExternalLink, FlaskConical, Info, Pause, Pencil, Play, Square } from 'lucide-react';
import Panel, { PanelButton } from './Panel';

type GymStatus = 'idle' | 'running' | 'paused';

const SPEEDS = [1, 5, 50];

/**
 * Kick's "Stream info" panel. The stream details are static chrome; the gym
 * control rides along at the bottom, since this panel is where you'd go to
 * change what the stream is doing.
 *
 * Pause and Stop are distinct: pausing freezes the running gym in place (same
 * metrics, same "Time Live") so Start resumes it; Stop discards it, and the
 * next Start begins a fresh session.
 */
export default function StreamInfo({
  gymStatus,
  gymSpeed,
  onChangeGymSpeed,
  onStartGym,
  onPauseGym,
  onStopGym,
}: {
  gymStatus: GymStatus;
  gymSpeed: number;
  onChangeGymSpeed: (speed: number) => void;
  onStartGym: () => void;
  onPauseGym: () => void;
  onStopGym: () => void;
}) {
  const gymOn = gymStatus === 'running';
  return (
    <Panel
      title="Stream info"
      icon={<Info size={13} />}
      bodyClassName="px-3 py-2.5"
      actions={
        <>
          <PanelButton label="Edit Stream Info">
            <Pencil size={13} />
          </PanelButton>
          <PanelButton label="Popout Stream Info">
            <ExternalLink size={13} />
          </PanelButton>
        </>
      }
    >
      <p className="text-sm text-white">Kick insights demo</p>
      <div className="mt-2 flex items-center gap-2">
        {/* Category art stands in as a tinted tile — we have no thumbnail. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-gradient-to-br from-[#2b1a4d] to-[#0f1a33] text-[var(--kick-green)]">
          <FlaskConical size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm text-white">Experimental</span>
          <span className="w-fit rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
            English
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--warn)]">
          <span
            className={`size-1.5 rounded-full ${gymOn ? 'bg-[var(--kick-green)]' : 'bg-[var(--text-muted)]'}`}
          />
          Gym{gymStatus === 'paused' ? ' (paused)' : ''}
        </span>
        <div className="flex gap-0.5 rounded bg-[var(--bg-surface)] p-0.5">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => onChangeGymSpeed(sp)}
              className={`flex-1 rounded py-1 text-xs font-semibold transition-colors hover:text-white ${
                gymSpeed === sp
                  ? 'bg-[var(--bg-elevated)] text-white'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              {sp}x
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={gymOn ? onPauseGym : onStartGym}
            className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors ${
              gymOn
                ? 'bg-[var(--bg-surface)] text-white hover:bg-[var(--bg-elevated)]'
                : 'bg-[var(--kick-green)] text-[var(--on-primary)] hover:bg-[var(--kick-green-dim)]'
            }`}
          >
            {gymOn ? <Pause size={12} /> : <Play size={12} />}
            {gymOn ? 'Pause' : gymStatus === 'paused' ? 'Resume' : 'Start gym'}
          </button>
          {gymStatus !== 'idle' && (
            <button
              onClick={onStopGym}
              className="flex h-7 items-center justify-center gap-1.5 rounded bg-[var(--bg-surface)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--bg-elevated)]"
            >
              <Square size={12} />
              Stop
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
