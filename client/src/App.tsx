// Gambit — one SSE subscription feeding both surfaces.
// Live mode is the default (a floating panel over the OBS preview); review is one click away.
import { useEffect, useState } from 'react';
import { useGambit, gym } from './useGambit';
import LivePanel from './components/LivePanel';
import Review from './components/Review';
import Chat from './components/Chat';
import { pct } from './types';

export default function App() {
  const s = useGambit();
  const [mode, setMode] = useState<'live' | 'review'>('live');
  const [gymOn, setGymOn] = useState(false);

  useEffect(() => {
    void gym.status().then((g) => setGymOn(g.status === 'running')).catch(() => undefined);
  }, []);

  const toggleGym = async () => {
    await (gymOn ? gym.stop() : gym.start(20, 7));
    setGymOn(!gymOn);
  };

  const bar = (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full"
          style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }} />
        <span className="text-[var(--text-muted)]">{s.connected ? 'live' : 'disconnected'}</span>
      </span>

      <button onClick={() => void toggleGym()}
        className="rounded bg-amber-500/20 px-2 py-1 font-medium text-amber-200 hover:bg-amber-500/30">
        {gymOn ? 'Stop gym' : 'Start gym'}
      </button>

      <span className="tnum text-[var(--text-muted)]">
        {s.context ? `${pct(s.context.participation)} of ${s.context.viewer_count} talking` : '—'}
        {' · '}{s.chat.length} msgs{' · '}{s.results.length} closed windows
        {' · '}{s.bandit?.decisions ?? 0} decisions
      </span>

      <div className="ml-auto flex gap-0.5 rounded-lg border border-[var(--border)] p-0.5">
        {(['live', 'review'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 font-semibold capitalize ${
              mode === m ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            }`}>
            {m}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)]">
      {bar}
      {mode === 'review' ? (
        <div className="min-h-0 flex-1 p-6"><Review s={s} /></div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          {/* the stream side: what the streamer is actually looking at, with our panel
              parked over the OBS preview */}
          <div className="relative min-h-0 flex-1 rounded-xl border border-[var(--border)] bg-[#0a0a0a]">
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="text-5xl opacity-15">🎮</div>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  gameplay — the streamer is looking here, not at us
                </p>
              </div>
            </div>

            <div className="absolute right-5 top-5">
              <LivePanel s={s} onDecide={s.decide} />
            </div>
          </div>

          {/* chat at full height: the volume is visible, and our line lands in it */}
          <div className="min-h-0 w-[340px] shrink-0">
            <Chat
              messages={s.chat}
              lastBot={s.lastBot}
              participation={s.context?.participation}
              viewers={s.context?.viewer_count}
            />
          </div>
        </div>
      )}
    </div>
  );
}
