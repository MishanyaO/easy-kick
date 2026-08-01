import { useState } from 'react';
import { ExternalLink, Flame, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import Heatmap from './Heatmap';
import { useClickHeatmap } from './useClickHeatmap';

/** Kick's "Stream Preview" panel. No real stream, so the body is filled by a
 *  banner: the offline banner normally, swapped for the live stream frame while
 *  the gym is running. Turning on the 🔥 heatmap overlays a click-density
 *  heatmap (mock clicks, plus any real click on the preview) on top of that
 *  frame. */
export default function StreamPreview({ gymOn }: { gymOn: boolean }) {
  const [heatmapOn, setHeatmapOn] = useState(false);
  // Tie generation to the toggle (not just being live) so the map starts empty
  // each time it's switched on and builds up gradually, instead of appearing
  // already full from clicks accumulated while it was hidden.
  const { points, addClick } = useClickHeatmap(gymOn && heatmapOn);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!gymOn || !heatmapOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    addClick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  return (
    <Panel
      title="Stream Preview"
      icon={<MonitorPlay size={16} />}
      className="h-full"
      bodyClassName="relative overflow-hidden bg-black"
      actions={
        <>
          {gymOn && (
            <PanelButton
              label={heatmapOn ? 'Hide click heatmap' : 'Show click heatmap'}
              active={heatmapOn}
              onClick={() => setHeatmapOn((on) => !on)}
            >
              <Flame size={16} />
            </PanelButton>
          )}
          <PanelButton label="Popout Stream Preview">
            <ExternalLink size={16} />
          </PanelButton>
        </>
      }
    >
      {/* Absolute fill: the body is the panel minus its header, so it is never
          exactly 16:9 and a normal-flow element would overflow across the header. */}
      <div className="absolute inset-0" onClick={handleClick}>
        <img
          src={gymOn ? '/live-stream-hidden.png' : '/offline-banner.webp'}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {gymOn && heatmapOn && (
          <Heatmap points={points} className="pointer-events-none absolute inset-0 size-full" />
        )}
      </div>
    </Panel>
  );
}
