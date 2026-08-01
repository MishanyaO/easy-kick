// One SSE subscription, one reducer, one state object for both surfaces.
import { useEffect, useReducer, useRef } from 'react';
import { cellKey } from './types';
import type {
  ActionFrame, Arm, Autonomy, BanditFrame, Belief, ChatFrame, ClickPoint, ClosedPoll,
  ContextFrame, DigestFrame, Frame, Mode, PollFrame, ResultFrame,
} from './types';
export type { ClosedPoll } from './types';

/** The bot's username in chat, live and in the gym. */
export const BOT_NAME = 'gambit';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const CONTROL_KEY = import.meta.env.VITE_CONTROL_API_KEY;
const controlHeaders = (): Record<string, string> =>
  CONTROL_KEY ? { 'X-Control-Key': CONTROL_KEY } : {};

const MAX_SPARK = 90;
/** Chat messages replayed on connect. Generous because a result's transcript reads back
 *  through this: at the story's ~24 messages a minute, 1000 is around forty minutes of
 *  scrollback, so most pins on the chart can show the room around them. The pane itself
 *  only paints its last few hundred. */
const BACKLOG = 1000;

export type GambitState = {
  connected: boolean;
  chat: ChatFrame[];
  context: ContextFrame | null;
  /** participation over time, for the ambient sparkline */
  spark: number[];
  /** viewer count over time — "Viewers" */
  viewerSpark: number[];
  /** unique chatters over time — "Talking", same scale as viewerSpark */
  activeViewersSpark: number[];
  /** msgs/min over time — the "engagement" graph */
  engagementSpark: number[];
  /** messages + reactions (redemptions, gifts) per minute over time — "Activity" */
  actionsSpark: number[];
  /** Same three series, never truncated — Insights shows the whole session and zooms
   *  into a range, so unlike the strip sparks above it can't drop old samples. Which of
   *  these each surface draws, under what name, is `metrics.ts`. */
  viewerHistory: number[];
  activeViewersHistory: number[];
  actionsHistory: number[];
  /** virtual elapsed seconds ("Time Live") at each history sample, for the Insights
   *  x-axis — the gym runs its own clock, sped up relative to wall time, so real
   *  timestamps would misrepresent how far apart samples actually are in-session. */
  historyElapsedS: number[];
  /** our own most recent chat line. Held OUTSIDE the chat window on purpose: the window
   *  turns over in seconds, and Kick has no pinned messages, so deriving this from the
   *  visible messages means the proof of the ACT step vanishes almost immediately. */
  lastBot: ChatFrame | null;
  /** the suggestion currently awaiting the streamer, if any */
  pending: ActionFrame | null;
  /** actions that fired and are being measured, keyed by action id */
  inflight: Record<string, ActionFrame>;
  /** every action frame seen this session, by id. `inflight` empties as windows close and
   *  a skipped suggestion never enters it at all, so without this the ledger's own rows
   *  cannot say what line they were — which is most of what a streamer opens one to read. */
  seen: Record<string, ActionFrame>;
  /** every closed window, newest first */
  results: (ResultFrame & { action?: ActionFrame; tick: number })[];
  /** context frames received so far — lets a result be placed on the spark timeline
   *  it closed under, even after that spark's window has scrolled */
  tick: number;
  bandit: BanditFrame | null;
  /** Every posterior after each bandit frame, keyed `state|arm`.
   *
   *  The backend sends a snapshot of the table and never a history, but "it learned" is a
   *  claim about the *sequence* — beliefs that started identical and pulled apart as
   *  evidence arrived. A still frame of the current table cannot make that claim, so the
   *  client keeps the sequence it was streamed.
   *
   *  Raw α/β rather than a mean: the readable quantity is one belief compared against
   *  another, which needs both distributions and not two summary numbers. Every cell is
   *  appended on every frame, so trails are index-aligned and can be zipped. Cleared by
   *  `reset` with everything else. */
  banditTrail: Record<string, Belief[]>;
  /** the poll currently taking votes, if the open window has one */
  poll: PollFrame | null;
  /** the most recently closed poll/quiz's final split, if the streamer hasn't dismissed it
   *  and no newer bot line has replaced it — see the `chat`/`result` reducer cases */
  closedPoll: ClosedPoll | null;
  /** chat_digest cards, newest first — never posted to chat, never scored */
  digests: DigestFrame[];
  /** taps on the video, oldest first — what the Stream Preview heatmap draws */
  clicks: ClickPoint[];
  /** the backend stopped its clock on a beat it wants looked at. The map freezes on it
   *  instead of fading, since nothing is arriving to keep it alive */
  held: boolean;
};

const MAX_DIGESTS = 20;
/** Comfortably more than the 200 results the ledger keeps, so every visible row can
 *  still find its action. */
const MAX_SEEN = 260;

const EMPTY: GambitState = {
  connected: false, chat: [], context: null, spark: [], viewerSpark: [], activeViewersSpark: [],
  engagementSpark: [],
  actionsSpark: [], lastBot: null,
  viewerHistory: [], activeViewersHistory: [], actionsHistory: [], historyElapsedS: [],
  pending: null, inflight: {}, seen: {}, results: [], bandit: null, banditTrail: {},
  poll: null, closedPoll: null, digests: [], tick: 0, clicks: [],
  held: false,
};

/** Taps kept on screen at once. A rally lands a few hundred inside a second or two, so this
 *  is sized to hold a whole one — and to bound it: the map is a density, and once a spot is
 *  saturated more points there change nothing but the redraw cost. The oldest fall off the
 *  front, which is also how the map drains after a burst. */
const MAX_CLICKS = 600;

/** Samples of each belief kept for the policy map. A bandit frame lands on every decision
 *  and every window close, so this is a few hundred decisions' worth. */
const MAX_TRAIL = 300;

/** Insertion-ordered and bounded: string ids keep their insertion order in a JS object,
 *  so dropping the oldest is a slice of the key list. */
function remember(seen: Record<string, ActionFrame>, f: ActionFrame): Record<string, ActionFrame> {
  const next = { ...seen, [f.id]: f };
  const ids = Object.keys(next);
  if (ids.length <= MAX_SEEN) return next;
  return Object.fromEntries(ids.slice(ids.length - MAX_SEEN).map((id) => [id, next[id]]));
}

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
        chat: [...s.chat, f],
        lastBot: isBot ? f : s.lastBot,
        // A new bot line is "a new thing" — the closed poll's tally has had its moment.
        closedPoll: isBot ? null : s.closedPoll,
      };
    }

    case 'hold':
      return { ...s, held: true };

    case 'context':
      return {
        ...s,
        context: f,
        // The clock is running again — a context frame only lands on a tick.
        held: false,
        spark: [...s.spark.slice(-MAX_SPARK + 1), f.participation],
        viewerSpark: [...s.viewerSpark.slice(-MAX_SPARK + 1), f.viewer_count ?? 0],
        activeViewersSpark: [...s.activeViewersSpark.slice(-MAX_SPARK + 1), f.unique_chatters],
        engagementSpark: [...s.engagementSpark.slice(-MAX_SPARK + 1), f.msgs_per_min],
        actionsSpark: [...s.actionsSpark.slice(-MAX_SPARK + 1), f.actions_per_min],
        viewerHistory: [...s.viewerHistory, f.viewer_count ?? 0],
        activeViewersHistory: [...s.activeViewersHistory, f.unique_chatters],
        // `actions_per_min`, matching `actionsSpark` above. This read `msgs_per_min` while
        // nothing consumed it; Insights draws it now, and the same series under the same
        // label has to be the same number on both surfaces.
        actionsHistory: [...s.actionsHistory, f.actions_per_min],
        historyElapsedS: [...s.historyElapsedS, f.uptime_s],
        tick: s.tick + 1,
      };

    case 'action':
      // auto_fire actions never wait for the streamer; they go straight to measuring
      return f.auto_fire
        ? { ...s, seen: remember(s.seen, f), inflight: { ...s.inflight, [f.id]: f } }
        : { ...s, seen: remember(s.seen, f), pending: f };

    // The running tally of the open poll. Republished every tick, so it is a replace,
    // never an accumulate — the backend owns the dedupe and we must not re-add on top of it.
    case 'poll':
      return { ...s, poll: f };

    case 'result': {
      // A rail-forced no-op is NOT a decision (his §6): no posterior update, no lift, and
      // it must not appear in the ledger or it drowns the real windows. It can still close
      // an expired suggestion, so remove that card instead of leaving a stale action whose
      // approval endpoint will correctly return 404.
      if (f.outcome === 'railed') {
        if (s.pending?.id !== f.action_id) return s;
        return { ...s, pending: null };
      }
      const action = s.inflight[f.action_id] ?? s.seen[f.action_id];
      const rest = Object.fromEntries(
        Object.entries(s.inflight).filter(([id]) => id !== f.action_id),
      );
      const wasThisPoll = s.poll?.action_id === f.action_id;
      return {
        ...s,
        inflight: rest,
        // a `nothing` decision closes a window too — keep it, it is a real trial
        results: [{ ...f, action, tick: Math.max(s.tick - 1, 0) }, ...s.results].slice(0, 200),
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

    case 'bandit': {
      const banditTrail = { ...s.banditTrail };
      for (const p of f.posteriors) {
        const prev = banditTrail[cellKey(p.state, p.arm)] ?? [];
        const next = [...prev, { alpha: p.alpha, beta: p.beta }];
        banditTrail[cellKey(p.state, p.arm)] =
          next.length > MAX_TRAIL ? next.slice(next.length - MAX_TRAIL) : next;
      }
      return {
        ...s,
        // Only the frame published at a decision carries `last_decision`; the one at window
        // close does not. Replacing wholesale would blank the draw a second after it
        // happened, which is precisely the moment worth looking at.
        bandit: f.last_decision ? f : { ...f, last_decision: s.bandit?.last_decision },
        banditTrail,
      };
    }

    case 'digest':
      return { ...s, digests: [f, ...s.digests].slice(0, MAX_DIGESTS) };

    // A batch of taps on the video. Stamped on arrival rather than trusted from the wire:
    // the backend clock is virtual and runs faster than this one, so its timestamps are the
    // wrong units to fade a blob by.
    case 'clicks': {
      const born = Date.now();
      // Bounded by count, never by age. The renderer owns fading and its clock stops while
      // a run is held, so a point that looks stale by wall time may still be on screen —
      // dropping it here is what made a held map blink away the instant the run resumed.
      const next = [...s.clicks, ...f.points.map(([x, y]) => ({ x, y, born }))];
      return {
        ...s,
        clicks: next.length > MAX_CLICKS ? next.slice(next.length - MAX_CLICKS) : next,
      };
    }

    default:
      return s;
  }
}

export function useGambit() {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const stateRef = useRef(state);
  const sessionRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    // The server replays recent chat plus this session's controller history on connect.
    const src = new EventSource(`${API_BASE}/stream?backlog=${BACKLOG}`);
    src.onopen = () => dispatch({ kind: 'open' });
    src.onerror = () => dispatch({ kind: 'close' });
    src.onmessage = (e) => {
      try {
        const frame = JSON.parse(e.data) as Frame;
        // Chat and clicks are the two frames that carry no sequence: both are live audience
        // traffic rather than session record, so they go straight through and never touch
        // the ordering gate below.
        if (frame.type === 'chat' || frame.type === 'clicks') {
          dispatch({ kind: 'frame', frame });
          return;
        }

        const previousSession = sessionRef.current;
        const sessionChanged = previousSession !== frame.session_id;
        if (sessionChanged) {
          sessionRef.current = frame.session_id;
          sequenceRef.current = 0;
        }
        if (frame.seq <= sequenceRef.current) return;
        sequenceRef.current = frame.seq;

        // Reset reaches open tabs. A changed session also clears a client whose reset
        // frame fell out of the bounded history before it reconnected.
        if (frame.type === 'reset' || (previousSession !== null && sessionChanged)) {
          dispatch({ kind: 'reset' });
        }
        if (frame.type !== 'reset') dispatch({ kind: 'frame', frame });
      } catch {
        // a malformed frame must not tear down the stream
      }
    };
    return () => src.close();
  }, []);

  /** Approve or veto a pending suggestion. Optimistic: the backend confirms via a result. */
  const decide = async (id: string, verdict: 'send' | 'dismiss') => {
    dispatch(verdict === 'send' ? { kind: 'approve', id } : { kind: 'dismiss', id });
    await fetch(`${API_BASE}/controller/action/${id}/${verdict}`, {
      method: 'POST',
      headers: controlHeaders(),
    })
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
  start: (speed = 20, seed = 7, mode: 'gym' | 'scenario' = 'gym') =>
    fetch(`${API_BASE}/dev/gym?speed=${speed}&seed=${seed}&mode=${mode}`, { method: 'POST' }),
  /** Resumes a paused gym in place (same metrics, same "Time Live") if one is paused. */
  pause: () => fetch(`${API_BASE}/dev/gym/pause`, { method: 'POST' }),
  /** Hot-changes the tick rate of a running or paused gym — no restart, takes effect
   *  on the next tick. */
  setSpeed: (speed: number) =>
    fetch(`${API_BASE}/dev/gym/speed?speed=${speed}`, { method: 'PATCH' }),
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
      headers: { 'Content-Type': 'application/json', ...controlHeaders() },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
};
