import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Panel, { PanelButton } from './Panel';
import { StreamIcon } from './icons';
import type { ContextFrame } from '../types';
import MultiSpark from '../components/MultiSpark';
import type { GambitState } from '../useGambit';

/** uptime_s -> HH:MM:SS, the way Kick renders "Time Live". */
function elapsed(seconds: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(seconds / 3600)}:${p((seconds % 3600) / 60)}:${p(seconds % 60)}`;
}

const VIEWERS_COLOR = '#6aa9ff';
const ACTIONS_COLOR = 'var(--warn)';
const ACTIVE_VIEWERS_COLOR = 'var(--kick-green)';

/**
 * Kick's "Session Info" strip. The cells are Kick's; the numbers are the
 * controller's. Viewers and actions (comments + reactions) used to be their own
 * cells but read better as a graph — it's the one place on the dashboard that
 * shows their shape over time, not just the instant value.
 */
export default function SessionInfo({
  context,
  live,
  speed = 1,
  viewerSpark,
  activeViewersSpark,
  actionsSpark,
}: {
  context: ContextFrame | null;
  live: boolean;
  /** Gym virtual-seconds-per-real-second, so the clock can keep ticking between frames. */
  speed?: number;
  viewerSpark: GambitState['viewerSpark'];
  activeViewersSpark: GambitState['activeViewersSpark'];
  actionsSpark: GambitState['actionsSpark'];
}) {
  // Context frames land every few real seconds; interpolating locally between them is
  // what makes "Time Live" look live instead of stepping in visible jumps.
  const anchor = useRef<{ uptime_s: number; atMs: number } | null>(null);
  const [, forceTick] = useState(0);

  if (!context) {
    // A stop clears the context, and the clock has to go with it — an interpolated
    // value would otherwise sit there frozen at whatever the last frame said.
    anchor.current = null;
  } else if (anchor.current?.uptime_s !== context.uptime_s) {
    anchor.current = { uptime_s: context.uptime_s, atMs: Date.now() };
  }

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [live]);

  const displayUptime = anchor.current
    ? anchor.current.uptime_s + ((Date.now() - anchor.current.atMs) / 1000) * speed
    : null;

  const cells: [string, string][] = [
    ['Session', live ? 'LIVE' : 'OFFLINE'],
    ['Time Live', displayUptime != null ? elapsed(displayUptime) : '-'],
    // Static channel chrome — no followers/subs on the wire, same as Stream info's details.
    ['Followers', '1,284'],
    ['Sub Count', '38'],
  ];

  return (
    <Panel
      title="Session Info"
      icon={<StreamIcon className="size-3.5" />}
      actions={
        <PanelButton label="Popout Session Info">
          <ExternalLink size={13} />
        </PanelButton>
      }
      bodyClassName="flex"
    >
      <div className="flex w-full divide-x divide-[var(--border)] border-b border-[var(--border)]">
        {cells.map(([label, value], i) => (
          <div key={label} className="flex min-w-0 shrink-0 flex-col gap-1.5 px-3 py-2.5">
            {i === 0 ? (
              <span
                className={`w-[60px] px-1.5 py-0.5 text-center text-[11px] font-bold tracking-wide ${
                  live ? 'bg-[var(--kick-green)] text-[var(--on-primary)]' : 'bg-[var(--bg-elevated)] text-white'
                }`}
              >
                {value}
              </span>
            ) : (
              <span className="tnum truncate text-sm text-white">{value}</span>
            )}
            <span className="text-xs text-[var(--text-secondary)]">{label}</span>
          </div>
        ))}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="size-1.5 rounded-full" style={{ background: VIEWERS_COLOR }} />
              Viewers
              <span className="tnum text-white">
                {context?.viewer_count != null ? context.viewer_count : '-'}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="size-1.5 rounded-full" style={{ background: ACTIVE_VIEWERS_COLOR }} />
              {/* `unique_chatters`. "Talking" everywhere, so this panel and the Insights
                  chart are naming the same number the same way. */}
              Talking
              <span className="tnum text-white">
                {context ? context.unique_chatters : '-'}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="size-1.5 rounded-full" style={{ background: ACTIONS_COLOR }} />
              Actions
              <span className="tnum text-white">
                {context ? context.actions_per_min.toFixed(1) : '-'}/min
              </span>
            </span>
          </div>
          <MultiSpark
            height={26}
            series={[
              { data: viewerSpark, color: VIEWERS_COLOR, scaleGroup: 'viewers' },
              { data: activeViewersSpark, color: ACTIVE_VIEWERS_COLOR, scaleGroup: 'viewers' },
              { data: actionsSpark, color: ACTIONS_COLOR },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}
