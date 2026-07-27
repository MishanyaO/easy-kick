// The Insights popout — what the drawer's header button opens in a new tab.
//
// Kick's own popouts are a bare panel header over a full-bleed body
// (dashboard.kick.com/popout/<channel>/<panel>), so this wears the same header the
// drawer does and gives the whole viewport to Review — where the Actions ledger and
// the Tactics tab live. Same SSE subscription as the dashboard tab.
import { LineChart } from 'lucide-react';
import Review from '../components/Review';
import { useGambit } from '../useGambit';

export default function InsightsPage() {
  const s = useGambit();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-surface)]">
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4">
        <span className="shrink-0 text-white">
          <LineChart size={13} />
        </span>
        <h2 className="truncate text-base font-semibold text-white">Insights</h2>
        <span
          className="ml-1.5 size-2 rounded-full transition-colors duration-300"
          title={s.connected ? 'Connected' : 'Disconnected'}
          style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-6">
        <Review s={s} />
      </div>
    </div>
  );
}
