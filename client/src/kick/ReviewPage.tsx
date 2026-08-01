// The full report, at `?review` — the Actions ledger, Tactics, and the participation
// leaderboard, given the whole viewport.
//
// NOT the Insights panel's popout. Kick's popout icon means "this same panel, in its own
// window", and this page is deliberately different content, which is why it hangs off its
// own button and its own URL. The honest popout is `?insights` (`InsightsPanelPage`).
//
// Same SSE subscription as the dashboard tab, and its own gym controls so a run can be
// started and stopped without going back.
import { BarChart3 } from 'lucide-react';
import Review from '../components/Review';
import GymControls from './GymControls';
import { useGymControls } from './useGymControls';
import { useGambit } from '../useGambit';

export default function ReviewPage() {
  const s = useGambit();
  // Same server-side gym the dashboard drives — this tab just gets its own buttons,
  // so you can start and stop a run without going back to the other tab.
  const gym = useGymControls(s.reset);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-surface)]">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4">
        <span className="shrink-0 text-white">
          <BarChart3 size={13} />
        </span>
        <h2 className="truncate text-base font-semibold text-white">Full report</h2>
        <span
          className="ml-1.5 size-2 rounded-full transition-colors duration-300"
          title={s.connected ? 'Connected' : 'Disconnected'}
          style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }}
        />
        <div className="ml-auto shrink-0">
          <GymControls gym={gym} variant="bar" />
        </div>
      </header>

      {/* The page's one scroller. The header stays put — it carries the gym controls and the
          connection dot, which are about the run rather than about where you are in the
          ledger — and everything below it scrolls as a single document.
          The padding is on the inner box, not on the scroller: a scroller's own padding-top
          is scrolled-through space that nothing clips, so with `p-6` out here the ledger's
          pinned header sat 24px down and rows stayed visible in the gap above it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-6">
          <Review s={s} />
        </div>
      </div>
    </div>
  );
}
