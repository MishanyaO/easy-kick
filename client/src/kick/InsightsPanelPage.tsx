// `?insights` — the Insights panel, popped out. Kick's popout icon means "this same panel,
// in its own window", and this honours that literally: the body is the identical component
// the docked panel renders.
//
// It looks thin, and that is correct. The panel's steady state is "nothing needs you right
// now", and its job is the moment that isn't true: a streamer parks this on a second monitor
// and approves the bot's suggestions without leaving their OBS scene. The fuller analytical
// view is a different thing behind a different button, at `?review`.
import { LineChart } from 'lucide-react';
import InsightsPanel from './InsightsPanel';
import GymControls from './GymControls';
import { useGymControls } from './useGymControls';
import { useGambit } from '../useGambit';

export default function InsightsPanelPage() {
  const s = useGambit();
  const gym = useGymControls(s.reset);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-surface)]">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4">
        <span className="shrink-0 text-white">
          <LineChart size={13} />
        </span>
        <h2 className="truncate text-base font-semibold text-white">Insights</h2>
        <span
          className="ml-1.5 size-2 rounded-full transition-colors duration-300"
          title={s.connected ? 'Connected' : 'Disconnected'}
          style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }}
        />
        <div className="ml-auto shrink-0">
          <GymControls gym={gym} variant="bar" />
        </div>
      </header>

      {/* Capped, not full-bleed. The panel's content is approval cards and digest notes —
          short things — and a card stretched across a 1600px monitor for twenty characters
          of text reads as a layout bug rather than as roominess. Kick's own popouts are a
          column too. Centred so it sits where the eye already is on a second screen. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col">
        <InsightsPanel s={s} onDecide={s.decide} />
      </div>
    </div>
  );
}
