/**
 * DESIGN REFERENCE — not part of the product. Reachable at `/?design`.
 *
 * The two approved prototypes (ticket 004, confirmed by the team 2026-07-26) rebuilt as one
 * self-contained file: **F** (live panel) and **R7** (review). Everything here runs on
 * invented data with a controller for stepping through states, so a surface can be judged
 * without waiting for a gym run to produce the right moment.
 *
 * The living implementations are `src/components/{LivePanel,Review,Chat}.tsx`. When those and
 * this disagree, those win — this exists to show the intended design, including states the
 * real app reaches rarely.
 *
 * NOTE: the review half deliberately preserves the pre-Gambit model it was approved under
 * (lull/debate/raid, msgs-per-minute). The shipped app uses Gambit's model — three chat
 * states and participation rate. Kept as-approved so the record matches what the team saw.
 *
 * Delete this directory and the `?design` branch in main.tsx when nobody refers back.
 */
import { useEffect, useRef, useState } from 'react';
import { Zap, Clock } from 'lucide-react';

/* ────────────────────────────── invented data ───────────────────────────── */

type Phase = 'healthy' | 'detected' | 'fired' | 'measured';
const PHASES: Phase[] = ['healthy', 'detected', 'fired', 'measured'];

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** 48 points of msgs/min: steady → dip (the lull) → recovery after the action fires. */
const SERIES = (() => {
  const rand = lcg(7);
  return Array.from({ length: 48 }, (_, i) => {
    const base = i < 26 ? 34 : i < 30 ? 34 - (i - 25) * 5 : i < 38 ? 14 : 14 + (i - 37) * 3.4;
    return Math.max(2, Math.round(base + (rand() - 0.5) * 5));
  });
})();
const CUTOFF: Record<Phase, number> = { healthy: 26, detected: 32, fired: 38, measured: 48 };
const seriesFor = (p: Phase) => SERIES.slice(0, CUTOFF[p]);
const firedAt = (p: Phase) => (p === 'fired' || p === 'measured' ? 34 : null);

const suggestion = {
  reason: 'msgs/min down 62% over 2 min',
  copy: 'Chat — which map should I ban next, Mirage or Nuke?',
  arm: 'this-or-that',
  armNote: 'least data — trying it',
  expiresIn: 148,
};
const verdictNow = { rpmBefore: 15, rpmAfter: 38, uniqueBefore: 22, uniqueAfter: 31, window: '2 min', label: 'Worked' };
const measuring = { remaining: 72, total: 120 };

const CHAT = [
  ['moon_lily', 'yo whats the game today'], ['xX_gamer_Xx', 'ranked lets goooo'],
  ['quiet_kev', 'hi chat'], ['sn1per', 'that spray was insane'], ['lurk_bot', 'o7'],
  ['darya_k', 'is this the new patch?'], ['moon_lily', 'mirage is so overplayed'],
  ['tkachuk', 'nuke better'], ['quiet_kev', '...'], ['sn1per', 'nuke fs'],
] as const;

type Verdict = 'Worked' | 'Neutral' | 'Backfired' | "Can't tell";
type State = 'lull' | 'debate' | 'raid_wave';

type Trial = {
  id: string; minsAgo: number; state: State; arm: string; copy: string;
  rpmBefore: number; rpmAfter: number; uniqueBefore: number; uniqueAfter: number;
  verdict: Verdict; explore: boolean; replies: number; heldMin: number;
  votes?: { option: string; count: number }[];
  sampleReplies?: string[];
  raiders?: { arrived: number; spoke: number };
  contaminated?: string;
};

const ARMS: Record<State, string[]> = {
  lull: ['open-question', 'this-or-that', 'callout-lurker'],
  debate: ['poll-two-camps', 'ask-for-reasons'],
  raid_wave: ['catch-up-card', 'shoutout-raider'],
};
const STATE_LABEL: Record<State, string> = { lull: 'LULL', debate: 'DEBATE', raid_wave: 'RAID' };
const VERDICT_COLOR: Record<Verdict, string> = {
  Worked: 'var(--kick-green)', Neutral: 'var(--text-muted)',
  Backfired: 'var(--danger)', "Can't tell": 'var(--warn)',
};
const ARM_COLORS = ['var(--kick-green)', 'var(--warn)', 'var(--text-secondary)', '#6aa9ff', '#ff7ad9'];
const WINDOW_MIN = 2;

const TRIALS: Trial[] = [
  { id: 't12', minsAgo: 3, state: 'lull', arm: 'this-or-that', copy: 'Chat — which map should I ban next, Mirage or Nuke?', rpmBefore: 15, rpmAfter: 38, uniqueBefore: 22, uniqueAfter: 31, verdict: 'Worked', explore: true, replies: 9, heldMin: 4, sampleReplies: ['nuke every time', 'mirage is stale ban it', 'NUKE', 'mirage', 'ban mirage pls'] },
  { id: 't11', minsAgo: 19, state: 'raid_wave', arm: 'catch-up-card', copy: 'Welcome raiders — we are 40 min into a ranked grind, currently 3-1 up.', rpmBefore: 31, rpmAfter: 52, uniqueBefore: 28, uniqueAfter: 61, verdict: 'Worked', explore: false, replies: 12, heldMin: 5, raiders: { arrived: 47, spoke: 33 } },
  { id: 't10', minsAgo: 34, state: 'lull', arm: 'open-question', copy: 'What is everyone working on today?', rpmBefore: 12, rpmAfter: 17, uniqueBefore: 19, uniqueAfter: 21, verdict: 'Neutral', explore: false, replies: 2, heldMin: 1 },
  { id: 't09', minsAgo: 47, state: 'debate', arm: 'poll-two-camps', copy: 'Settle it — Mirage or Nuke? Type 1 or 2.', rpmBefore: 44, rpmAfter: 71, uniqueBefore: 33, uniqueAfter: 45, verdict: 'Worked', explore: false, replies: 23, heldMin: 6, votes: [{ option: 'Mirage', count: 41 }, { option: 'Nuke', count: 67 }] },
  { id: 't08', minsAgo: 58, state: 'lull', arm: 'callout-lurker', copy: 'quiet_kev has been here 2 hours and said three words. Kev. Speak.', rpmBefore: 14, rpmAfter: 41, uniqueBefore: 20, uniqueAfter: 29, verdict: 'Worked', explore: true, replies: 14, heldMin: 3, sampleReplies: ['LMAO kev exposed', 'hi', 'kev say something', 'he is typing', 'KEV'] },
  { id: 't07', minsAgo: 72, state: 'lull', arm: 'this-or-that', copy: 'Next game — ranked or casual?', rpmBefore: 16, rpmAfter: 34, uniqueBefore: 21, uniqueAfter: 27, verdict: 'Worked', explore: false, replies: 7, heldMin: 4 },
  { id: 't06', minsAgo: 85, state: 'raid_wave', arm: 'shoutout-raider', copy: 'Huge thanks to @darya_k for the raid!', rpmBefore: 29, rpmAfter: 33, uniqueBefore: 26, uniqueAfter: 34, verdict: 'Neutral', explore: true, replies: 3, heldMin: 1, raiders: { arrived: 38, spoke: 9 } },
  { id: 't05', minsAgo: 96, state: 'lull', arm: 'open-question', copy: 'Anyone else on the new patch?', rpmBefore: 13, rpmAfter: 14, uniqueBefore: 18, uniqueAfter: 18, verdict: 'Neutral', explore: false, replies: 0, heldMin: 0 },
  { id: 't04', minsAgo: 110, state: 'debate', arm: 'ask-for-reasons', copy: 'Nuke defenders — make your case in one line.', rpmBefore: 39, rpmAfter: 44, uniqueBefore: 30, uniqueAfter: 32, verdict: "Can't tell", explore: true, replies: 5, heldMin: 1, contaminated: 'a raid landed 40s into the after-window — the lift is not ours to claim', votes: [{ option: 'pro-Nuke', count: 12 }, { option: 'pro-Mirage', count: 9 }, { option: 'off-topic', count: 31 }] },
  { id: 't03', minsAgo: 124, state: 'lull', arm: 'this-or-that', copy: 'AWP or AK for the next round?', rpmBefore: 11, rpmAfter: 29, uniqueBefore: 17, uniqueAfter: 24, verdict: 'Worked', explore: false, replies: 8, heldMin: 3 },
  { id: 't02', minsAgo: 141, state: 'lull', arm: 'callout-lurker', copy: 'lurk_bot I can see you.', rpmBefore: 18, rpmAfter: 11, uniqueBefore: 19, uniqueAfter: 14, verdict: 'Backfired', explore: false, replies: 1, heldMin: 0 },
  { id: 't01', minsAgo: 158, state: 'lull', arm: 'open-question', copy: 'How is everyone doing?', rpmBefore: 14, rpmAfter: 15, uniqueBefore: 20, uniqueAfter: 19, verdict: 'Neutral', explore: false, replies: 1, heldMin: 0 },
];

const extraOf = (t: Trial) => (t.rpmAfter - t.rpmBefore) * WINDOW_MIN;
const toMsgs = (deltaRpm: number) => Math.round(deltaRpm * WINDOW_MIN);

type ArmStat = { state: State; arm: string; trials: number; meanLift: number; worked: number; lifts: number[] };

/** Ranked WITHIN a state, never across — arms from different states are not comparable. */
function armStats(): ArmStat[] {
  const out: ArmStat[] = [];
  for (const state of Object.keys(ARMS) as State[]) {
    for (const arm of ARMS[state]) {
      const ts = TRIALS.filter((t) => t.state === state && t.arm === arm).sort((a, b) => b.minsAgo - a.minsAgo);
      if (!ts.length) continue;
      const lifts = ts.map((t) => t.rpmAfter - t.rpmBefore);
      out.push({
        state, arm, trials: ts.length, lifts,
        meanLift: lifts.reduce((a, b) => a + b, 0) / ts.length,
        worked: ts.filter((t) => t.verdict === 'Worked').length,
      });
    }
  }
  const order = Object.keys(ARMS) as State[];
  return out.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.meanLift - a.meanLift);
}

/** What the bandit would pick next, as a recommendation rather than a posterior. */
function nextPick(state: State) {
  const arms = armStats().filter((s) => s.state === state);
  const untried = ARMS[state].filter((a) => !arms.some((s) => s.arm === a));
  if (untried.length) return { arm: untried[0], mode: 'explore' as const, why: 'never tried — no evidence either way' };
  const thin = arms.filter((a) => a.trials < 3).sort((a, b) => a.trials - b.trials)[0];
  const best = arms[0];
  if (thin && thin.arm !== best.arm) {
    return { arm: thin.arm, mode: 'explore' as const, why: `only ${thin.trials} tr${thin.trials === 1 ? 'y' : 'ies'} so far — worth another look` };
  }
  return { arm: best.arm, mode: 'exploit' as const, why: `best here — avg +${toMsgs(best.meanLift)} msgs over ${best.trials} tr${best.trials === 1 ? 'y' : 'ies'}` };
}

function trialSeries(t: Trial): number[] {
  const rand = lcg(Math.round(t.rpmBefore * 7919));
  return Array.from({ length: 24 }, (_, i) => {
    const base = i < 12 ? t.rpmBefore : t.rpmBefore + (t.rpmAfter - t.rpmBefore) * Math.min(1, (i - 11) / 5);
    return Math.max(1, base + (rand() - 0.5) * 4);
  });
}

/* ────────────────────────────── shared bits ─────────────────────────────── */

function Line({ data, height, colour = 'var(--kick-green)', fired = null, lullFrom = null, width = 320 }: {
  data: number[]; height: number; colour?: string; fired?: number | null; lullFrom?: number | null; width?: number;
}) {
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data, 10) * 1.1;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - (v / max) * (height - 4) - 2;
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}>
      {lullFrom !== null && lullFrom < data.length && (
        <rect x={x(lullFrom)} y={0} width={width - x(lullFrom)} height={height} fill="var(--warn)" opacity={0.09} />
      )}
      <path d={d} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {fired !== null && fired < data.length && (
        <line x1={x(fired)} y1={0} x2={x(fired)} y2={height} stroke="var(--text-primary)" strokeWidth="1"
          strokeDasharray="2 2" vectorEffect="non-scaling-stroke" opacity={0.6} />
      )}
    </svg>
  );
}

/* ─────────────────────────── F — the live panel ─────────────────────────── */

const SHELL = 'w-[360px] rounded-xl border bg-[var(--bg-surface)] shadow-[0_18px_50px_-8px_rgba(0,0,0,0.85)]';

function LivePanelF({ phase }: { phase: Phase }) {
  const data = seriesFor(phase);

  if (phase === 'healthy') {
    return (
      <div className={`${SHELL} border-[var(--border)] px-3 py-2`}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kick-green)]" />
          <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">STEADY</span>
          <div className="ml-1 min-w-0 flex-1 opacity-60"><Line data={data} height={20} /></div>
        </div>
      </div>
    );
  }

  if (phase === 'fired') {
    return (
      <div className={`${SHELL} border-[var(--border)] px-4 py-3`}>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--kick-green)]">MEASURING</span>
          <span className="tnum ml-auto text-2xl font-bold leading-none text-[var(--text-primary)]">
            {Math.floor(measuring.remaining / 60)}:{String(measuring.remaining % 60).padStart(2, '0')}
          </span>
        </div>
        <div className="mt-2 h-0.5 w-full rounded bg-[var(--border)]">
          <div className="h-0.5 rounded bg-[var(--kick-green)]"
            style={{ width: `${(1 - measuring.remaining / measuring.total) * 100}%` }} />
        </div>
        <p className="mt-2 truncate text-[11px] text-[var(--text-muted)]">“{suggestion.copy}”</p>
      </div>
    );
  }

  if (phase === 'measured') {
    return (
      <div className={`${SHELL} p-5`} style={{ borderColor: 'var(--kick-green)' }}>
        <span className="text-[11px] font-bold tracking-[0.25em] text-[var(--kick-green)]">
          {verdictNow.label.toUpperCase()}
        </span>
        <div className="mt-3 tnum text-5xl font-bold leading-none text-[var(--text-primary)]">
          {verdictNow.rpmBefore}
          <span className="text-[var(--text-muted)]">→</span>
          <span className="text-[var(--kick-green)]">{verdictNow.rpmAfter}</span>
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          msgs/min · +{verdictNow.uniqueAfter - verdictNow.uniqueBefore} chatters
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">vs the {verdictNow.window} before</p>
        <div className="mt-3"><Line data={data} height={40} fired={firedAt(phase)} lullFrom={29} /></div>
      </div>
    );
  }

  // detected — the only moment it takes real space, and it takes it loudly
  return (
    <div className={`${SHELL} p-5`} style={{ borderColor: 'var(--warn)' }}>
      <div className="flex items-center gap-1.5">
        <Zap size={15} className="text-[var(--warn)]" />
        <span className="text-[13px] font-bold tracking-[0.2em] text-[var(--warn)]">CHAT IS DYING</span>
        <span className="ml-auto tnum text-[10px] text-[var(--text-muted)]">
          {Math.floor(suggestion.expiresIn / 60)}:{String(suggestion.expiresIn % 60).padStart(2, '0')}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{suggestion.reason}</p>
      <p className="mt-4 text-[20px] font-semibold leading-tight text-[var(--text-primary)]">“{suggestion.copy}”</p>
      <button className="mt-4 w-full rounded-lg bg-[var(--kick-green)] py-4 text-base font-bold text-black">
        Send to chat
      </button>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
        <span>“{suggestion.arm}” · {suggestion.armNote}</span>
        <button className="underline">skip</button>
      </div>
    </div>
  );
}

/** Draggable stand-in for the undocked OBS panel. In the real product OBS supplies the
 *  title bar and the streamer drags it — our page cannot move its own window. */
function FloatingPanel({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (drag.current) setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    };
    const up = () => (drag.current = null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <div ref={host} className="absolute z-20" style={pos ? { left: pos.x, top: pos.y } : { right: 304, top: 32 }}>
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          const r = host.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        }}
        className="flex cursor-grab select-none items-center gap-1.5 rounded-t-lg border border-b-0 border-black/60 bg-[#2b2b2b] px-2 py-1 active:cursor-grabbing">
        <span className="text-[9px] font-semibold text-white/50">Kick Insights</span>
        <span className="ml-auto text-[9px] text-white/25">drag me</span>
      </div>
      {children}
    </div>
  );
}

/** Fake OBS chrome, so a 360px panel is judged next to its real neighbours. */
function LiveSurface({ phase }: { phase: Phase }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#1e1e1e] text-white">
      <div className="flex items-center gap-3 border-b border-black/50 bg-[#2b2b2b] px-3 py-1.5 text-[11px] text-white/50">
        <span className="font-semibold text-white/70">OBS Studio</span>
        <span>File</span><span>Edit</span><span>View</span><span>Docks</span><span>Tools</span>
        <span className="ml-auto text-[10px]">fake chrome — context only</span>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center border-b border-black/50 bg-[#0a0a0a]">
            <div className="text-center">
              <div className="text-5xl opacity-15">🎮</div>
              <p className="mt-2 text-[11px] text-white/25">gameplay — he is looking here, not at us</p>
            </div>
          </div>
          <div className="flex h-24 shrink-0 divide-x divide-black/50 bg-[#232323] text-[10px] text-white/35">
            <div className="flex-1 p-2"><div className="mb-1 text-white/50">Scenes</div>Main<br />Starting soon</div>
            <div className="flex-1 p-2"><div className="mb-1 text-white/50">Sources</div>Game Capture<br />Webcam</div>
            <div className="flex-1 p-2"><div className="mb-1 text-white/50">Audio Mixer</div>Desktop<br />Mic/Aux</div>
          </div>
        </div>

        <div className="flex w-[280px] shrink-0 flex-col border-l border-black/50 bg-[#222]">
          <div className="border-b border-black/50 px-2 py-1.5 text-[10px] font-semibold text-white/50">Kick Chat</div>
          <div className="flex-1 space-y-1 overflow-hidden p-2 text-[11px] leading-snug">
            {CHAT.map(([user, text], i) => (
              <div key={i}>
                <span style={{ color: `hsl(${(user.length * 47) % 360} 70% 62%)` }} className="font-semibold">{user}</span>
                <span className="text-white/45">: {text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* parked over the preview, clear of chat — the whole point of F */}
        <FloatingPanel><LivePanelF phase={phase} /></FloatingPanel>
      </div>
    </div>
  );
}

/* ──────────────────────────── R7 — the review ───────────────────────────── */

const GROUPS: { verdict: Verdict; blurb: string }[] = [
  { verdict: 'Worked', blurb: 'do more of these' },
  { verdict: 'Neutral', blurb: 'chat did not move' },
  { verdict: 'Backfired', blurb: 'chat got quieter after — avoid these' },
  { verdict: "Can't tell", blurb: 'something else happened in the window' },
];

function Expanded({ t }: { t: Trial }) {
  const totalVotes = t.votes?.reduce((a, v) => a + v.count, 0) ?? 0;
  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-base)]/40 px-4 py-3">
      <p className="text-[13px] leading-snug text-[var(--text-primary)]">“{t.copy}”</p>

      {t.contaminated && (
        <p className="mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--warn)', color: 'var(--text-secondary)' }}>
          <span className="font-bold" style={{ color: 'var(--warn)' }}>Can’t tell — </span>{t.contaminated}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {[['MSGS / MIN', t.rpmBefore, t.rpmAfter], ['UNIQUE CHATTERS', t.uniqueBefore, t.uniqueAfter]].map(
          ([label, before, after]) => (
            <div key={label as string} className="rounded-lg bg-[var(--bg-base)] px-3 py-2">
              <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">{label}</div>
              <div className="tnum mt-0.5 text-lg font-bold text-[var(--text-primary)]">
                {before}<span className="text-[var(--text-muted)]">→</span>
                <span className="text-[var(--kick-green)]">{after}</span>
              </div>
            </div>
          ))}
        <div className="rounded-lg bg-[var(--bg-base)] px-3 py-2">
          <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">TACTIC</div>
          <div className="mt-0.5 text-[13px] font-medium text-[var(--text-primary)]">
            {t.arm} <span className="text-[10px]" style={{ color: t.explore ? 'var(--warn)' : 'var(--text-muted)' }}>
              {t.explore ? 'explore' : 'exploit'}
            </span>
          </div>
        </div>
      </div>

      {t.votes && (
        <div className="mt-3">
          <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">
            HOW CHAT VOTED · {totalVotes} VOTES PARSED FROM CHAT
          </div>
          <div className="mt-1.5 space-y-1.5">
            {t.votes.map((v) => (
              <div key={v.option} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[12px] text-[var(--text-secondary)]">{v.option}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--bg-elevated)]">
                  <div className="h-3 rounded" style={{
                    width: `${(v.count / totalVotes) * 100}%`,
                    background: v.option === 'off-topic' ? 'var(--text-muted)' : 'var(--kick-green)',
                  }} />
                </div>
                <span className="tnum w-14 shrink-0 text-right text-[12px] font-bold text-[var(--text-primary)]">{v.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {t.sampleReplies && (
        <div className="mt-3">
          <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">
            REPLIES TO THIS MESSAGE · {t.replies} TOTAL
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {t.sampleReplies.map((r, i) => (
              <span key={i} className="rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">{r}</span>
            ))}
          </div>
        </div>
      )}

      {t.raiders && (
        <div className="mt-3">
          <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">RAIDERS WHO STAYED AND SPOKE</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--bg-elevated)]">
              <div className="h-3 rounded bg-[var(--kick-green)]"
                style={{ width: `${(t.raiders.spoke / t.raiders.arrived) * 100}%` }} />
            </div>
            <span className="tnum text-[12px] font-bold text-[var(--text-primary)]">
              {t.raiders.spoke}/{t.raiders.arrived}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function TrialDots({ lifts, mean, max, colour }: { lifts: number[]; mean: number; max: number; colour: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="relative h-6 flex-1">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
      <div className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--text-primary)]"
        style={{ left: pct(mean) }} title={`average +${toMsgs(mean)} msgs`} />
      {lifts.map((v, i) => (
        <div key={i} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-surface)]"
          style={{ left: pct(v), background: colour }} title={`one try: +${toMsgs(v)} msgs`} />
      ))}
    </div>
  );
}

function TacticsTab() {
  const states: State[] = ['lull', 'debate', 'raid_wave'];
  const explored = TRIALS.filter((t) => t.explore).length;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
      {states.map((state) => {
        const arms = armStats().filter((s) => s.state === state);
        const pick = nextPick(state);
        const untried = ARMS[state].filter((a) => !arms.some((s) => s.arm === a));
        const max = Math.max(...arms.flatMap((a) => a.lifts), 1) * 1.08;
        const accent = pick.mode === 'explore' ? 'var(--warn)' : 'var(--kick-green)';
        return (
          <section key={state} className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-secondary)]">{STATE_LABEL[state]}</span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {TRIALS.filter((t) => t.state === state).length} trials · {arms.length}/{ARMS[state].length} tactics tried
              </span>
            </div>

            <div className="mt-2.5 flex items-baseline gap-2 rounded-lg border px-3 py-2" style={{ borderColor: accent }}>
              <div className="min-w-0">
                <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: accent }}>
                  NEXT TIME · {pick.mode.toUpperCase()}
                </span>
                <div className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{pick.arm}</div>
              </div>
              <span className="ml-auto shrink-0 text-right text-[10px] leading-tight text-[var(--text-muted)]">{pick.why}</span>
            </div>

            <div className="mt-3 flex items-center gap-3 text-[9px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-0.5 rounded bg-[var(--text-primary)]" />average · each dot is one try
              </span>
              <span className="ml-auto truncate">extra msgs in the {WINDOW_MIN} min after →</span>
            </div>

            <div className="mt-1 space-y-1.5">
              {arms.map((s, i) => (
                <div key={s.arm} className="flex items-center gap-2">
                  <span className="flex w-28 shrink-0 items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ARM_COLORS[i % ARM_COLORS.length] }} />
                    <span className="truncate text-[12px] text-[var(--text-primary)]">{s.arm}</span>
                  </span>
                  <TrialDots lifts={s.lifts} mean={s.meanLift} max={max} colour={ARM_COLORS[i % ARM_COLORS.length]} />
                  <span className="tnum w-[86px] shrink-0 text-right text-[12px] text-[var(--text-primary)]">
                    <span className="font-bold">avg +{toMsgs(s.meanLift)}</span>
                    <span className="text-[10px] font-normal text-[var(--text-muted)]"> msgs</span>
                  </span>
                  <span className="tnum w-[46px] shrink-0 text-right text-[10px] text-[var(--text-muted)]">
                    {s.worked}/{s.trials}
                  </span>
                </div>
              ))}
              {untried.map((a) => (
                <div key={a} className="flex items-center gap-2 opacity-45">
                  <span className="flex w-28 shrink-0 items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--text-muted)]" />
                    <span className="truncate text-[12px] text-[var(--text-secondary)]">{a}</span>
                  </span>
                  <div className="relative h-6 flex-1">
                    <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
                  </div>
                  <span className="w-[86px] shrink-0 text-right text-[11px] text-[var(--text-muted)]">—</span>
                  <span className="w-[46px] shrink-0 text-right text-[10px] text-[var(--text-muted)]">new</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-secondary)]">HOW THE EXPERIMENT RUNS</span>
        <div className="mt-3 flex gap-2">
          <div className="flex-1 rounded-lg bg-[var(--bg-base)] px-3 py-2">
            <div className="tnum text-2xl font-bold text-[var(--kick-green)]">{TRIALS.length - explored}</div>
            <div className="text-[10px] text-[var(--text-muted)]">exploit — used the best known tactic</div>
          </div>
          <div className="flex-1 rounded-lg bg-[var(--bg-base)] px-3 py-2">
            <div className="tnum text-2xl font-bold text-[var(--warn)]">{explored}</div>
            <div className="text-[10px] text-[var(--text-muted)]">explore — tried a less-proven one on purpose</div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          Each state runs its own experiment. Tactics are only ever compared{' '}
          <span className="text-[var(--text-primary)]">within</span> a state — a debate always
          out-chats a lull, so ranking them together would measure the state, not the tactic.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
          With {TRIALS.length} trials nothing here is settled. Fast replay exists to run enough of them that it is.
        </p>
      </section>
    </div>
  );
}

function ReviewSurface() {
  const [tab, setTab] = useState<'actions' | 'tactics'>('actions');
  const [filter, setFilter] = useState<'all' | State>('all');
  const [open, setOpen] = useState<string | null>(null);
  const states: State[] = ['lull', 'debate', 'raid_wave'];

  const visible = TRIALS.filter((t) => filter === 'all' || t.state === filter);
  const total = visible.reduce((a, t) => a + extraOf(t), 0);
  const best = filter === 'all' ? null : armStats().filter((s) => s.state === filter)[0];

  const Tile = ({ k, label, ts }: { k: 'all' | State; label: string; ts: Trial[] }) => (
    <button onClick={() => { setFilter(k); setOpen(null); }}
      className="flex-1 rounded-lg border px-3 py-2 text-left transition-colors"
      style={{ borderColor: filter === k ? 'var(--kick-green)' : 'var(--border)', background: filter === k ? 'var(--bg-elevated)' : 'transparent' }}>
      <div className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-muted)]">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-lg font-bold text-[var(--kick-green)]">+{ts.reduce((a, t) => a + extraOf(t), 0)}</span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {ts.filter((t) => t.verdict === 'Worked').length}/{ts.length} worked
        </span>
      </div>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)] p-6">
      <div className="flex items-baseline gap-3">
        <span className="tnum text-4xl font-bold leading-none text-[var(--kick-green)]">+{total}</span>
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">messages that would not exist</div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {visible.length} actions · measured against the {WINDOW_MIN} min before each one
          </div>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-lg border border-[var(--border)] p-0.5">
          {(['actions', 'tactics'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize ${
                tab === k ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {tab === 'tactics' ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col"><TacticsTab /></div>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <Tile k="all" label="EVERYTHING" ts={TRIALS} />
            {states.map((s) => <Tile key={s} k={s} label={STATE_LABEL[s]} ts={TRIALS.filter((t) => t.state === s)} />)}
          </div>

          {best && (
            <p className="mt-2.5 text-[11px] text-[var(--text-secondary)]">
              Best tactic for a {STATE_LABEL[filter as State].toLowerCase()}:{' '}
              <span className="font-bold text-[var(--text-primary)]">{best.arm}</span>, avg +{toMsgs(best.meanLift)} msgs
              over {best.trials} tries. <span className="text-[var(--text-muted)]">Ranked within this state only.</span>
            </p>
          )}

          <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {GROUPS.map(({ verdict, blurb }) => {
              const rows = visible.filter((t) => t.verdict === verdict).sort((a, b) => extraOf(b) - extraOf(a));
              if (!rows.length) return null;
              return (
                <section key={verdict}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="h-2 w-2 rounded-sm" style={{ background: VERDICT_COLOR[verdict] }} />
                    <span className="text-[11px] font-bold tracking-[0.2em]" style={{ color: VERDICT_COLOR[verdict] }}>
                      {verdict.toUpperCase()}
                    </span>
                    <span className="tnum text-[11px] text-[var(--text-muted)]">{rows.length}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">— {blurb}</span>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                    {rows.map((t, i) => {
                      const isOpen = open === t.id;
                      return (
                        <div key={t.id} style={{ borderTop: i ? '1px solid var(--border)' : undefined }}>
                          <button onClick={() => setOpen(isOpen ? null : t.id)}
                            className="flex w-full items-center gap-3 bg-[var(--bg-surface)] px-3 py-2.5 text-left hover:bg-[var(--bg-elevated)]">
                            <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{isOpen ? '▾' : '▸'}</span>
                            {filter === 'all' && (
                              <span className="w-14 shrink-0 text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
                                {STATE_LABEL[t.state]}
                              </span>
                            )}
                            <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">“{t.copy}”</p>
                            <span className="hidden shrink-0 sm:block">
                              <Line data={trialSeries(t)} height={22} width={100} colour={VERDICT_COLOR[t.verdict]} />
                            </span>
                            <span className="tnum w-[74px] shrink-0 text-right text-[15px] font-bold" style={{ color: VERDICT_COLOR[t.verdict] }}>
                              {extraOf(t) > 0 ? '+' : ''}{extraOf(t)}
                              <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">msgs</span>
                            </span>
                            <span className="tnum w-[68px] shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
                              {t.replies} {t.replies === 1 ? 'reply' : 'replies'}
                            </span>
                            <span className="tnum w-[56px] shrink-0 text-right text-[11px] text-[var(--text-muted)]">
                              {t.heldMin > 0 ? `held ${t.heldMin}m` : '—'}
                            </span>
                            <span className="hidden w-[100px] shrink-0 truncate text-right text-[10px] text-[var(--text-muted)] lg:block">
                              {t.arm}
                            </span>
                          </button>
                          {isOpen && <Expanded t={t} />}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────── controller ────────────────────────────── */

export default function Reference() {
  const [surface, setSurface] = useState<'live' | 'review'>('live');
  const [phase, setPhase] = useState<Phase>('healthy');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setSurface((s) => (s === 'live' ? 'review' : 'live'));
      const i = PHASES.indexOf(phase);
      if (e.key === 'ArrowDown') setPhase(PHASES[(i + 1) % PHASES.length]);
      if (e.key === 'ArrowUp') setPhase(PHASES[(i - 1 + PHASES.length) % PHASES.length]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)]">
      {surface === 'live' ? <LiveSurface phase={phase} /> : <ReviewSurface />}

      <div className="pointer-events-auto fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-white/95 px-2 py-1.5 text-black shadow-2xl">
        <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-black/40">design ref</span>
        {(['live', 'review'] as const).map((s) => (
          <button key={s} onClick={() => setSurface(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${surface === s ? 'bg-black text-white' : 'hover:bg-black/10'}`}>
            {s === 'live' ? 'F — live panel' : 'R7 — review'}
          </button>
        ))}

        {surface === 'live' && (
          <>
            <span className="mx-1 h-5 w-px bg-black/20" />
            {PHASES.map((p) => (
              <button key={p} onClick={() => setPhase(p)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${p === phase ? 'bg-black text-white' : 'hover:bg-black/10'}`}>
                {p}
              </button>
            ))}
          </>
        )}
        <span className="ml-1 pr-1 text-[10px] text-black/45">←→ surface · ↑↓ phase</span>
      </div>

      {surface === 'live' && phase === 'healthy' && (
        <div className="pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5 text-[11px] text-white/70">
          <Clock size={11} className="mr-1 inline" />
          resting state — step phases to see detected / fired / measured
        </div>
      )}
    </div>
  );
}
