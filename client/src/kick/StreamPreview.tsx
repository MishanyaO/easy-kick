import { ExternalLink, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';

/** Kick's "Stream Preview" panel. No real stream, so the body is filled by the
 *  offline banner normally, swapped for a looping gym video while the gym is
 *  running. */
export default function StreamPreview({ gymOn }: { gymOn: boolean }) {
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
          exactly 16:9 and a normal-flow element would overflow across the header. */}
      {gymOn ? (
        <video
          src="/video-placeholder.mp4"
          autoPlay
          loop
          muted
          playsInline
          poster="/gym.png"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <img
          src="/offline-banner.webp"
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </Panel>
  );
}
