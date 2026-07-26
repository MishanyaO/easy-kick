import { ExternalLink, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';

/** Kick's "Stream Preview" panel. No video source, so the offline banner fills it. */
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
      {/* Absolute fill: the body is the panel minus its header, so it is never
          exactly 16:9 and a normal-flow image would overflow across the header. */}
      <img src="/offline-banner.webp" alt="" className="absolute inset-0 size-full object-cover" />
    </Panel>
  );
}
