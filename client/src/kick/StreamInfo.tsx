import { ExternalLink, Info, Pencil } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import GymControls from './GymControls';
import type { GymControlsState } from './useGymControls';

/**
 * Kick's "Stream info" panel. The stream details are static chrome; the gym
 * control rides along at the bottom, since this panel is where you'd go to
 * change what the stream is doing.
 */
export default function StreamInfo({ gym }: { gym: GymControlsState }) {
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
        {/* Category box art. */}
        <img
          src="/category-meccha-chameleon.png"
          alt=""
          className="size-9 shrink-0 rounded object-cover"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm text-white">Meccha Chameleon</span>
          <span className="w-fit rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
            English
          </span>
        </div>
      </div>

      <GymControls gym={gym} />
    </Panel>
  );
}
