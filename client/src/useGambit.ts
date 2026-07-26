// One SSE subscription, one reducer, one state object for both surfaces.
import { useEffect, useReducer, useRef } from 'react';
import type {
  ActionFrame, BanditFrame, ChatFrame, ContextFrame, Frame, ResultFrame,
} from './types';

/** The bot's username in chat, live and in the gym. */
export const BOT_NAME = 'gambit';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const MAX_CHAT = 80;
const MAX_SPARK = 90;
const BACKLOG = 200; // chat messages replayed on connect // ~3 min of context frames at one every 2s

export type GambitState = {
  connected: boolean;
  chat: ChatFrame[];
  context: ContextFrame | null;
  /** participation over time, for the ambient sparkline */
  spark: number[];
  /** our own most recent chat line. Held OUTSIDE the chat window on purpose: the window
   *  turns over in seconds, and Kick has no pinned messages, so deriving this from the
   *  visible messages means the proof of the ACT step vanishes almost immediately. */
  lastBot: ChatFrame | null;
  /** the suggestion currently awaiting the streamer, if any */
  pending: ActionFrame | null;
  /** actions that fired and are being measured, keyed by action id */
  inflight: Record<string, ActionFrame>;
  /** every closed window, newest first */
  results: (ResultFrame & { action?: ActionFrame })[];
  bandit: BanditFrame | null;
};

const EMPTY: GambitState = {
  connected: false, chat: [], context: null, spark: [], lastBot: null,
  pending: null, inflight: {}, results: [], bandit: null,
};

type Msg =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'approve'; id: string }
  | { kind: 'dismiss'; id: string };

function reduce(s: GambitState, m: Msg): GambitState {
  if (m.kind === 'open') return { ...s, connected: true };
  if (m.kind === 'close') return { ...s, connected: false };

  // Optimistic local transitions — the backend confirms with a `result` frame.
  if (m.kind === 'approve') {
    const a = s.pending;
    if (!a || a.id !== m.id) return s;
    return { ...s, pending: null, inflight: { ...s.inflight, [a.id]: a } };
  }
  if (m.kind === 'dismiss') {
    return s.pending?.id === m.id ? { ...s, pending: null } : s;
  }

  const f = m.frame;

  switch (f.type) {
    case 'chat':
      return {
        ...s,
        chat: [...s.chat.slice(-MAX_CHAT + 1), f],
        lastBot: f.username === BOT_NAME ? f : s.lastBot,
      };

    case 'context':
      return {
        ...s,
        context: f,
        spark: [...s.spark.slice(-MAX_SPARK + 1), f.participation],
      };

    case 'action':
      // auto_fire actions never wait for the streamer; they go straight to measuring
      return f.auto_fire
        ? { ...s, inflight: { ...s.inflight, [f.id]: f } }
        : { ...s, pending: f };

    case 'result': {
      // A rail-forced no-op is NOT a decision (his §6): no posterior update, no lift, and
      // it must not appear in the ledger or it drowns the real windows.
      if (f.outcome === 'railed') return s;
      const action = s.inflight[f.action_id];
      const rest = Object.fromEntries(
        Object.entries(s.inflight).filter(([id]) => id !== f.action_id),
      );
      return {
        ...s,
        inflight: rest,
        // a `nothing` decision closes a window too — keep it, it is a real trial
        results: [{ ...f, action }, ...s.results].slice(0, 200),
        pending: s.pending?.id === f.action_id ? null : s.pending,
      };
    }

    case 'bandit':
      return { ...s, bandit: f };

    default:
      return s;
  }
}

export function useGambit() {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    // Replay recent chat on connect so the panel is never blank on a refresh mid-stream.
    const src = new EventSource(`${API_BASE}/stream?backlog=${BACKLOG}`);
    src.onopen = () => dispatch({ kind: 'open' });
    src.onerror = () => dispatch({ kind: 'close' });
    src.onmessage = (e) => {
      try {
        dispatch({ kind: 'frame', frame: JSON.parse(e.data) as Frame });
      } catch {
        // a malformed frame must not tear down the stream
      }
    };
    return () => src.close();
  }, []);

  /** Approve or veto a pending suggestion. Optimistic: the backend confirms via a result. */
  const decide = async (id: string, verdict: 'send' | 'dismiss') => {
    dispatch(verdict === 'send' ? { kind: 'approve', id } : { kind: 'dismiss', id });
    await fetch(`${API_BASE}/controller/action/${id}/${verdict}`, { method: 'POST' })
      .catch(() => undefined);
  };

  return { ...state, decide };
}

export const gym = {
  start: (speed = 20, seed = 7) =>
    fetch(`${API_BASE}/dev/gym?speed=${speed}&seed=${seed}`, { method: 'POST' }),
  stop: () => fetch(`${API_BASE}/dev/gym`, { method: 'DELETE' }),
  status: () => fetch(`${API_BASE}/dev/gym`).then((r) => r.json()),
};
