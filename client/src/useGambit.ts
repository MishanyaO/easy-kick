// One SSE subscription, one reducer, one state object for both surfaces.
import { useEffect, useReducer, useRef } from 'react';
import type {
  ActionFrame, Arm, Autonomy, BanditFrame, ChatFrame, ContextFrame, DigestFrame, Frame, Mode,
  PollFrame, ResultFrame,
} from './types';

/** The bot's username in chat, live and in the gym. */
export const BOT_NAME = 'gambit';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

const MAX_CHAT = 80;
const MAX_SPARK = 90;
const BACKLOG = 200; // chat messages replayed on connect // ~3 min of context frames at one every 2s

/** A poll/quiz window's final split, kept around after close until the streamer dismisses
 *  it or a new bot line replaces it — see the `closedPoll` notes on the reducer below. */
export type ClosedPoll = {
  action_id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  voters: number;
};

export type GambitState = {
  connected: boolean;
  chat: ChatFrame[];
  context: ContextFrame | null;
  /** participation over time, for the ambient sparkline */
  spark: number[];
  /** viewer count over time */
  viewerSpark: number[];
  /** unique chatters over time — the "active viewers" graph, same scale as viewerSpark */
  activeViewersSpark: number[];
  /** msgs/min over time — the "engagement" graph */
  engagementSpark: number[];
  /** comments + reactions (redemptions, gifts) over time — Session Info's activity graph */
  actionsSpark: number[];
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
  /** the poll currently taking votes, if the open window has one */
  poll: PollFrame | null;
  /** the most recently closed poll/quiz's final split, if the streamer hasn't dismissed it
   *  and no newer bot line has replaced it — see the `chat`/`result` reducer cases */
  closedPoll: ClosedPoll | null;
  /** chat_digest cards, newest first — never posted to chat, never scored */
  digests: DigestFrame[];
};

const MAX_DIGESTS = 20;

const EMPTY: GambitState = {
  connected: false, chat: [], context: null, spark: [], viewerSpark: [], activeViewersSpark: [],
  engagementSpark: [],
  actionsSpark: [], lastBot: null,
  pending: null, inflight: {}, results: [], bandit: null, poll: null, closedPoll: null,
  digests: [],
};

type Msg =
  | { kind: 'frame'; frame: Frame }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'approve'; id: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'dismissPoll' }
  | { kind: 'reset' };

function reduce(s: GambitState, m: Msg): GambitState {
  if (m.kind === 'open') return { ...s, connected: true };
  if (m.kind === 'close') return { ...s, connected: false };
  // The gym stopped: the backend just handed out a fresh store/bandit/controller/context,
  // so everything accumulated from the old run (chat, sparklines, ledger, cards) is stale.
  if (m.kind === 'reset') return { ...EMPTY, connected: s.connected };

  // Optimistic local transitions — the backend confirms with a `result` frame.
  if (m.kind === 'approve') {
    const a = s.pending;
    if (!a || a.id !== m.id) return s;
    return { ...s, pending: null, inflight: { ...s.inflight, [a.id]: a } };
  }
  if (m.kind === 'dismiss') {
    return s.pending?.id === m.id ? { ...s, pending: null } : s;
  }
  if (m.kind === 'dismissPoll') {
    return { ...s, closedPoll: null };
  }

  const f = m.frame;

  switch (f.type) {
    case 'chat': {
      const isBot = f.username === BOT_NAME;
      return {
        ...s,
        chat: [...s.chat.slice(-MAX_CHAT + 1), f],
        lastBot: isBot ? f : s.lastBot,
        // A new bot line is "a new thing" — the closed poll's tally has had its moment.
        closedPoll: isBot ? null : s.closedPoll,
      };
    }

    case 'context':
      return {
        ...s,
        context: f,
        spark: [...s.spark.slice(-MAX_SPARK + 1), f.participation],
        viewerSpark: [...s.viewerSpark.slice(-MAX_SPARK + 1), f.viewer_count ?? 0],
        activeViewersSpark: [...s.activeViewersSpark.slice(-MAX_SPARK + 1), f.unique_chatters],
        engagementSpark: [...s.engagementSpark.slice(-MAX_SPARK + 1), f.msgs_per_min],
        actionsSpark: [...s.actionsSpark.slice(-MAX_SPARK + 1), f.actions_per_min],
      };

    case 'action':
      // auto_fire actions never wait for the streamer; they go straight to measuring
      return f.auto_fire
        ? { ...s, inflight: { ...s.inflight, [f.id]: f } }
        : { ...s, pending: f };

    // The running tally of the open poll. Republished every tick, so it is a replace,
    // never an accumulate — the backend owns the dedupe and we must not re-add on top of it.
    case 'poll':
      return { ...s, poll: f };

    case 'result': {
      // A rail-forced no-op is NOT a decision (his §6): no posterior update, no lift, and
      // it must not appear in the ledger or it drowns the real windows.
      if (f.outcome === 'railed') return s;
      const action = s.inflight[f.action_id];
      const rest = Object.fromEntries(
        Object.entries(s.inflight).filter(([id]) => id !== f.action_id),
      );
      const wasThisPoll = s.poll?.action_id === f.action_id;
      return {
        ...s,
        inflight: rest,
        // a `nothing` decision closes a window too — keep it, it is a real trial
        results: [{ ...f, action }, ...s.results].slice(0, 200),
        pending: s.pending?.id === f.action_id ? null : s.pending,
        poll: wasThisPoll ? null : s.poll,
        // the window that owned the poll is closed, but its final split stays pinned above
        // chat — collapsing straight to plain text the instant it resolves reads as broken.
        closedPoll: wasThisPoll && action?.options.length
          ? {
            action_id: f.action_id,
            question: action.body,
            options: action.options,
            votes: f.votes,
            voters: Object.values(f.votes).reduce((a, n) => a + n, 0),
          }
          : s.closedPoll,
      };
    }

    case 'bandit':
      return { ...s, bandit: f };

    case 'digest':
      return { ...s, digests: [f, ...s.digests].slice(0, MAX_DIGESTS) };

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

  /** Clear a closed poll's tally from the pinned banner by hand — purely local, nothing
   *  server-side to confirm. */
  const dismissPoll = () => dispatch({ kind: 'dismissPoll' });

  /** Wipe every accumulated frame back to a blank slate — call this right after the gym
   *  stops, since the backend has just discarded the state that produced all of it. */
  const reset = () => dispatch({ kind: 'reset' });

  return { ...state, decide, dismissPoll, reset };
}

export const gym = {
  start: (speed = 20, seed = 7) =>
    fetch(`${API_BASE}/dev/gym?speed=${speed}&seed=${seed}`, { method: 'POST' }),
  /** Resumes a paused gym in place (same metrics, same "Time Live") if one is paused. */
  pause: () => fetch(`${API_BASE}/dev/gym/pause`, { method: 'POST' }),
  stop: () => fetch(`${API_BASE}/dev/gym`, { method: 'DELETE' }),
  status: () => fetch(`${API_BASE}/dev/gym`).then((r) => r.json()),
};

export type Policy = {
  enabled: boolean;
  autonomy: Record<Arm, Autonomy>;
  mode: Mode;
  fire_rate: Partial<Record<Arm, number>>;
};

export const controller = {
  policy: (): Promise<Policy> => fetch(`${API_BASE}/controller/policy`).then((r) => r.json()),
  setAutonomy: (body: {
    enabled?: boolean;
    autonomy?: Partial<Record<Arm, Autonomy>>;
    mode?: Mode;
    fire_rate?: Partial<Record<Arm, number>>;
  }) =>
    fetch(`${API_BASE}/controller/autonomy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
};
