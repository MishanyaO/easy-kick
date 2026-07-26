import { ExternalLink } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import { StreamIcon } from './icons';
import { pct, type ContextFrame } from '../types';

/** uptime_s -> HH:MM:SS, the way Kick renders "Time Live". */
function elapsed(seconds: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(seconds / 3600)}:${p((seconds % 3600) / 60)}:${p(seconds % 60)}`;
}

/**
 * Kick's "Session Info" strip. The cells are Kick's; the numbers are the
 * controller's — viewers, participation and uptime off the context frame.
 */
export default function SessionInfo({
  context,
  live,
}: {
  context: ContextFrame | null;
  live: boolean;
}) {
  const cells: [string, string][] = [
    ['Session', live ? 'LIVE' : 'OFFLINE'],
    ['Viewers', context?.viewer_count != null ? String(context.viewer_count) : '-'],
    ['Talking', context ? pct(context.participation) : '-'],
    ['Category', context?.category ?? '-'],
    ['Time Live', context ? elapsed(context.uptime_s) : '-'],
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
      <div className="grid w-full grid-cols-5 divide-x divide-[var(--border)] border-b border-[var(--border)]">
        {cells.map(([label, value], i) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
            {i === 0 ? (
              <span
                className={`w-fit px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${
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
      </div>
    </Panel>
  );
}
