import { ExternalLink, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';

/**
 * Kick's "Stream Preview" panel.
 *
 * There is no video source, so the offline banner fills the panel on its own.
 * `object-cover` because Kick's preview box is ~1.65:1 while the banner is 16:9.
 */
export default function StreamPreview() {
  return (
    <Panel
      title="Stream Preview"
      icon={<MonitorPlay size={16} />}
      className="h-full"
      bodyClassName="relative overflow-hidden bg-black"
      actions={
        <PanelButton label="Popout Stream Preview">
          <ExternalLink size={16} />
        </PanelButton>
      }
    >
      {/* Absolute fill rather than an aspect-ratio box: a 16:9 child is taller
          than the row and, being centred, would overflow up across the header. */}
      <img src="/offline-banner.webp" alt="" className="absolute inset-0 size-full object-cover" />
    </Panel>
  );
}
