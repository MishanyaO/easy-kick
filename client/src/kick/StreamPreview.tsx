import { useEffect, useState } from 'react';
import { ExternalLink, Flame, MonitorPlay } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import { CLICK_FADE_MS } from '../types';
import { gym } from '../useGambit';
import Heatmap from './Heatmap';
import { useClickHeatmap, type Point } from './useClickHeatmap';

/** Kick's "Stream Preview" panel. No real stream, so the body is filled by a
 *  banner: the offline banner normally, swapped for the live stream frame while
 *  the gym is running. Turning on the 🔥 heatmap overlays the audience's taps on
 *  that frame — the running session's own clicks, arriving over SSE, plus any
 *  real click on the preview. Every tap fades out over `CLICK_FADE_MS`, so the map
 *  always shows where the room is looking *now* and a rally visibly ends.
 *
 *  It also opens itself when chat is answering a click rally. That is the one
 *  moment the map is the story rather than ambient decoration, and it is over in
 *  seconds — leaving it behind a toggle means the streamer reads about the surge
 *  in the ledger instead of watching it happen. */
export default function StreamPreview({
  gymOn,
  clicks,
  held = false,
}: {
  gymOn: boolean;
  clicks: Point[];
  /** The run stopped its own clock on a beat worth looking at, and the map stops with it —
   *  for as long as the streamer leaves it there. Resuming fades the picture out. */
  held?: boolean;
}) {
  // Two independent reasons the map can be up, kept apart on purpose. `manualOn` is the
  // streamer's own choice, owned by the 🔥 button and nothing else. `rallyActive` is the
  // transient auto-open a live rally forces; it clears itself when the taps stop. Coupling
  // the two into one flag is what left the button stuck on after a rally and made a manual
  // toggle look dead — the auto path kept overwriting it.
  const [manualOn, setManualOn] = useState(false);
  const [rallyActive, setRallyActive] = useState(false);
  const heatmapOn = manualOn || rallyActive;
  const { points, addClick } = useClickHeatmap(clicks);

  // A rally is the only thing that ever sends taps, so a *fresh* batch means the room is
  // answering one right now. `clicks` is bounded by count and never emptied, so its length
  // is not the signal — the last tap's `born` stamp is: it advances on every new batch and
  // stands still once the taps stop. `CLICK_FADE_MS` after the last one the map is empty and
  // the badge goes with it, returning the panel to whatever the streamer had set. A held run
  // has stopped that clock, so nothing expires until they resume and the two fade out together.
  const lastBorn = clicks.length ? clicks[clicks.length - 1].born : 0;
  useEffect(() => {
    if (!lastBorn) return;
    setRallyActive(true);
    if (held) return;
    const id = setTimeout(() => setRallyActive(false), CLICK_FADE_MS);
    return () => clearTimeout(id);
  }, [lastBorn, held]);

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
              onClick={() => {
                // Turning it on summons a rally so the map has something to show — the
                // audience only taps the video when asked, so an empty overlay is all a
                // bare toggle could ever reveal. Turning it off ends that rally, so the
                // taps stop and the map fades rather than running out its window unwatched.
                const turningOn = !heatmapOn;
                setManualOn(turningOn);
                if (turningOn) gym.summonClicks();
                else gym.stopClicks();
              }}
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
          <Heatmap
            points={points}
            frozen={held}
            className="pointer-events-none absolute inset-0 size-full"
          />
        )}
        {gymOn && heatmapOn && (rallyActive || held) && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--kick-green)]">
            {held ? 'held on the click rally' : 'chat is tapping'}
          </span>
        )}
      </div>
    </Panel>
  );
}
