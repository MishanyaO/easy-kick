import { ExternalLink } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import { ModActionsIcon } from './icons';

/**
 * Kick's own "Mod Actions" panel, restored to the slot it occupies on
 * dashboard.kick.com/stream (bottom row, right of Activity Feed).
 *
 * Inert chrome, deliberately: we have no moderation data, and Kick's own panel
 * is empty until a mod acts. Our Insights live in the draggable drawer instead
 * of squatting in this slot — see `InsightsDrawer`.
 */
export default function ModActions() {
  return (
    <Panel
      title="Mod Actions"
      icon={<ModActionsIcon className="size-3.5" />}
      className="h-full"
      bodyClassName="overflow-y-auto"
      actions={
        <PanelButton label="Popout Mod Actions">
          <ExternalLink size={13} />
        </PanelButton>
      }
    >
      {/* Kick renders an empty scroll viewport here until a moderation event lands. */}
      <div className="h-full w-full px-4 py-2" />
    </Panel>
  );
}
