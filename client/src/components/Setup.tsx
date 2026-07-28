// Before-stream config: manual fire-rate sliders vs. the bandit running on auto. No blending —
// in `manual` the bandit is never consulted; in `auto` the rates below are ignored entirely.
import { useEffect, useState } from 'react';
import { API_BASE } from '../useGambit';
import type { Arm, Mode } from '../types';

const REAL_ARMS: Arm[] = ['emote_rally', 'chat_poll', 'quiz'];
const LABEL: Record<string, string> = {
  emote_rally: 'Emote rally',
  chat_poll: 'Chat poll',
  quiz: 'Quiz',
};

export default function Setup() {
  const [mode, setMode] = useState<Mode>('auto');
  const [rates, setRates] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/controller/policy`)
      .then((r) => r.json())
      .then((p) => {
        if (p.mode) setMode(p.mode);
        if (p.fire_rate) setRates((r) => ({ ...r, ...p.fire_rate }));
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setSaved(false);
    await fetch(`${API_BASE}/controller/autonomy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, fire_rate: rates }),
    }).catch(() => undefined);
    setSaved(true);
  };

  return (
    <div className="mx-auto max-w-md space-y-6 p-6 text-sm text-[var(--text-primary)]">
      <div>
        <h2 className="mb-1 text-base font-semibold">Before you go live</h2>
        <p className="text-[var(--text-muted)]">
          Manual: each arm fires at the rate you set below, and the bandit never runs. Auto:
          rates are ignored and Thompson sampling explores freely.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
        {(['manual', 'auto'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 font-semibold capitalize ${
              mode === m
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className={`space-y-4 ${mode === 'auto' ? 'opacity-40' : ''}`}>
        {REAL_ARMS.map((arm) => (
          <div key={arm}>
            <div className="mb-1 flex justify-between">
              <span>{LABEL[arm]}</span>
              <span className="tnum text-[var(--text-muted)]">
                {(rates[arm] ?? 0).toFixed(1)} / min
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={rates[arm] ?? 0}
              disabled={mode === 'auto'}
              onChange={(e) => setRates((r) => ({ ...r, [arm]: Number(e.target.value) }))}
              className="w-full"
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => void save()}
        className="w-full rounded-md bg-[var(--kick-green)] py-2 font-semibold text-black"
      >
        {saved ? 'Saved' : 'Save and start'}
      </button>
    </div>
  );
}
