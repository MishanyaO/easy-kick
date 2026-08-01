import { BarChart3, ExternalLink, LineChart } from 'lucide-react';
import Panel from './Panel';
import InsightsPanel from './InsightsPanel';
import type { GambitState } from '../useGambit';

/**
 * Ours, docked in the slot Kick's own (and, for us, permanently empty) Mod Actions panel
 * used to occupy: a scrollable list of what needs or had the streamer's attention — the
 * pending approval on top when there is one, followed by chat_digest history. The ambient
 * graphs live in Session Info now; closed windows and their verdicts live in Activity Feed
 * instead — this panel is about now and about-to-be-missed, not about history.
 *
 * Two header buttons, and the difference between them is deliberate. Kick's popout icon
 * means one specific thing everywhere else on this dashboard — *this same panel, in its own
 * window* — so it opens exactly that (`?insights`). The full report is different content,
 * not a bigger version of this panel, so it gets its own icon and its own URL (`?review`);
 * hiding it behind the popout icon would be a broken promise wearing a familiar affordance.
 */
export default function Insights({ s, onDecide }: {
  s: GambitState;
  onDecide: (id: string, v: 'send' | 'dismiss') => void;
}) {
  const link =
    'flex size-6 items-center justify-center rounded text-[var(--text-secondary)] ' +
    'transition-colors hover:bg-[var(--bg-elevated)] hover:text-white';

  return (
    <Panel
      title="Insights"
      icon={<LineChart size={13} />}
      className="h-full"
      bodyClassName="flex flex-col overflow-hidden"
      actions={
        <>
          <a
            href={`${window.location.pathname}?review`}
            target="_blank"
            rel="noopener"
            aria-label="Open the full report"
            title="Full report — ledger, policy map and rewards"
            className={link}
          >
            <BarChart3 size={13} />
          </a>
          <a
            href={`${window.location.pathname}?insights`}
            target="_blank"
            rel="noopener"
            aria-label="Pop out Insights"
            title="Pop out this panel"
            className={link}
          >
            <ExternalLink size={13} />
          </a>
        </>
      }
    >
      <InsightsPanel s={s} onDecide={onDecide} />
    </Panel>
  );
}
