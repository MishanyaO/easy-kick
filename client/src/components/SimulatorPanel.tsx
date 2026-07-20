import { useCallback, useEffect, useState } from 'react';
import { Play, Square, Repeat, AlertCircle } from 'lucide-react';
import { simulator, ReplayError, type ReplayStatus } from '../api';

const SPEEDS = [1, 2, 5, 10] as const;
const POLL_MS = 1000;

/** Dev-only control panel for the backend replay simulator. Shown by `npm run dev:simulator`. */
export default function SimulatorPanel() {
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [speed, setSpeed] = useState<number>(2);
  const [loop, setLoop] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A 404 means the server started without KICK_SIMULATOR_ENABLED. Polling cannot fix
  // that — it only floods the server log — so latch it and stop asking.
  const [disabled, setDisabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await simulator.status());
      setError(null);
    } catch (e) {
      if (e instanceof ReplayError && e.status === 404) {
        setDisabled(true);
        setError('simulator is off on the server — restart it with `npm run dev:simulator`');
      } else {
        setError(e instanceof ReplayError ? e.message : 'status check failed');
      }
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, disabled]);

  const run = async (fn: () => Promise<ReplayStatus>) => {
    try {
      setStatus(await fn());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  };

  const statusLabel = status && !disabled && (
    <span className="text-amber-200/70">
      {status.status === 'running'
        ? `${status.sent} sent${status.total > 0 ? ` · ${status.total}/cycle` : ''}`
        : 'idle'}
    </span>
  );

  const running = status?.status === 'running';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-amber-400">Simulator</span>

      <button
        onClick={() => void run(running ? simulator.stop : () => simulator.start(speed, loop))}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-1 font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 disabled:hover:bg-amber-500/20"
      >
        {running ? <Square size={12} /> : <Play size={12} />}
        {running ? 'Stop' : 'Start'}
      </button>

      <select
        value={speed}
        disabled={running}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="rounded bg-black/30 px-1.5 py-1 text-amber-100 disabled:opacity-40"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>

      <button
        onClick={() => setLoop((v) => !v)}
        disabled={running}
        title="Repeat the dataset when it ends"
        className={`flex items-center gap-1 rounded px-1.5 py-1 disabled:opacity-40 ${
          loop ? 'bg-amber-500/20 text-amber-200' : 'text-amber-200/40'
        }`}
      >
        <Repeat size={12} />
        loop
      </button>

      {statusLabel}

      {error && (
        <span className="flex items-center gap-1 text-red-300">
          <AlertCircle size={12} />
          {error}
        </span>
      )}
    </div>
  );
}
