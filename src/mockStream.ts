import type { ChatEvent, InsightEvent, ActionEvent, ActionResult, StreamEvent } from './types';

type Handler = (e: StreamEvent) => void;

const LOOP_S = 90;

const USERS = [
  'xqc_fan_99', 'snek', 'MOD_rina', 'juicer_andy', 'kkona_mike', 'pogo_pat',
  'lilw', 'degen_dan', 'alyx_tv', 'bruhmoment', 'clip_it_carl', 'n0va',
  'zoil_', 'mizkid42', 'pokefan88', 'grefg_alt', 'trainwatcher', 'emo_lime',
  'based_bella', 'cyr_fan', 'w_chat_leo', 'susjack', 'forsen_e', 'quin69btw',
];

const SUBS = new Set(['snek', 'pogo_pat', 'based_bella', 'alyx_tv', 'juicer_andy', 'n0va']);
const MODS = new Set(['MOD_rina', 'w_chat_leo']);

const EMOTES = ['KEKW', 'LULW', 'OMEGALUL', 'POG', 'peepoClap', 'Sadge', 'EZ', 'WICKED', 'monkaS', 'peepoLove'];

const NORMAL_LINES = [
  'lets goooo', 'W play', 'how did he hit that', 'lol', 'lmaooo', 'clip it',
  'bro what', 'that was actually insane', 'gg', 'no way', 'chat is this real',
  'L take', 'W streamer', 'hes cooking', 'run it back', 'nah thats crazy',
  'true tho', 'LMFAO', 'bruh', 'what was that', 'mods asleep', 'actual content',
  'this guy is cracked', 'peepoClap', 'KEKW', 'he said what', 'ratio',
  'ok that was clean', 'dayum', 'first time watcher, this normal?',
];

const LULL_LINES = [
  'lol', 'true', 'gg', 'bruh', 'anyway', 'z', 'what now', 'ok', 'hm',
  'next game when', 'lobby simulator', 'im back what happened', 'Sadge',
];

const SPIKE_LINES = [
  'OOOOOOO', 'LETS GOOOOO', 'NO WAY NO WAY', 'CLIP THAT RN', 'HOLY',
  'WHAT JUST HAPPENED', 'BROOOOO', 'INSANE', 'HE DID IT', 'POLL W',
  'chat was right LMAO', 'TOLD YOU', 'EZ CLAP', 'W W W W W', 'OMEGALUL',
  'THATS MY STREAMER', 'yyeeoooo', 'SCREAMING', 'i cant breathe',
];

const TOPICS: Record<string, string[]> = {
  normal: ['gameplay', 'ranked grind', 'that clutch', 'loadout'],
  lull: ['lobby wait', 'queue times', 'brb'],
  spike: ['THE POLL', 'that play', 'clip', 'chat called it'],
  settle: ['gameplay', 'next match', 'poll results'],
};

const QUESTIONS = [
  { id: 'q1', text: 'what rank is he?', asked_by: 'n0va', count: 4, score: 0.8 },
  { id: 'q2', text: 'is he doing a 24h stream?', asked_by: 'susjack', count: 2, score: 0.5 },
];

// named moments on the timeline, loop-relative seconds
const ANNOTATION_SCRIPT: { t: number; label: string }[] = [
  { t: 8, label: 'opened the case' },
  { t: 18, label: 'clutch vs 3' },
  { t: 47, label: 'chat picked Ascent' },
  { t: 55, label: 'insane 1v5 clutch' },
  { t: 74, label: 'roast battle w/ chat' },
];

// people to shout out, loop-relative seconds
const SHOUTOUT_SCRIPT: { t: number; username: string; kind: 'first_time' | 'returning' | 'new_sub'; detail: string }[] = [
  { t: 4, username: 'nova_kid', kind: 'first_time', detail: 'first message ever' },
  { t: 14, username: 'snek', kind: 'returning', detail: 'back after 3 weeks' },
  { t: 33, username: 'pogo_pat', kind: 'new_sub', detail: 'subbed 1m ago — not thanked' },
  { t: 52, username: 'emo_lime', kind: 'new_sub', detail: 'subbed just now — not thanked' },
  { t: 58, username: 'kkona_mike', kind: 'first_time', detail: 'first message ever' },
  { t: 71, username: 'degen_dan', kind: 'returning', detail: 'back after 5 days' },
];

// this streamer's normal ranges (drives the baseline band + "× normal" values)
const BASELINE = {
  hype: { low: 40, high: 62, avg: 50 },
  msgs_per_min: 110,
  unique_chatters: 53,
  sentiment: 0.68,
};

const x = (now: number, base: number) => Math.round((now / base) * 10) / 10;

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function phase(t: number): 'normal' | 'lull' | 'spike' | 'settle' {
  if (t < 25) return 'normal';
  if (t < 45) return 'lull';
  if (t < 62) return 'spike';
  return 'settle';
}

function hypeAt(t: number): number {
  const noise = () => (Math.random() - 0.5) * 4;
  if (t < 25) return 48 + Math.sin(t / 4) * 8 + noise(); // normal
  if (t < 45) return Math.max(12, 44 - (t - 25) * 1.5) + noise(); // lull decay
  if (t < 62) return Math.min(97, 55 + (t - 45) * 2.6) + noise(); // spike
  return Math.max(50, 88 - (t - 62) * 1.3) + noise(); // settle
}

function chatRate(t: number): number {
  const p = phase(t);
  if (p === 'lull') return Math.random() < 0.45 ? 1 : 0;
  if (p === 'spike') return 2 + Math.floor(Math.random() * 3);
  if (p === 'settle') return 1 + Math.floor(Math.random() * 2);
  return Math.random() < 0.8 ? 1 + Math.floor(Math.random() * 2) : 0;
}

let idCounter = 0;
const nextId = () => `e${++idCounter}`;

function makeChat(t: number): ChatEvent {
  const p = phase(t);
  const pool = p === 'lull' ? LULL_LINES : p === 'spike' ? SPIKE_LINES : NORMAL_LINES;
  const username = pick(USERS);
  const emotes: string[] = [];
  if (Math.random() < (p === 'spike' ? 0.7 : 0.3)) {
    emotes.push(pick(EMOTES));
    if (p === 'spike' && Math.random() < 0.5) emotes.push(pick(EMOTES));
  }
  return {
    type: 'chat',
    id: nextId(),
    ts: new Date().toISOString(),
    username,
    text: pick(pool),
    emotes,
    is_sub: SUBS.has(username),
    is_mod: MODS.has(username),
  };
}

function makeInsight(t: number, elapsed: number, started: number, loop: number): InsightEvent {
  const p = phase(t);
  const hype = Math.round(Math.max(0, Math.min(100, hypeAt(t))));
  const msgs = Math.round(hype * 2.2 + Math.random() * 10);
  const chatters = Math.round(hype * 0.9 + 8 + Math.random() * 6);
  const sentiment = Math.round(((p === 'lull' ? 0.35 : p === 'spike' ? 0.9 : 0.68) + (Math.random() - 0.5) * 0.1) * 100) / 100;
  const loopBase = elapsed - t;
  return {
    type: 'insight',
    ts: new Date().toISOString(),
    window_s: 30,
    msgs_per_min: msgs,
    unique_chatters: chatters,
    sentiment,
    hype,
    spike: p === 'spike',
    lull: p === 'lull',
    top_topics: TOPICS[p],
    top_emotes: p === 'spike' ? ['KEKW', 'POG', 'WICKED'] : p === 'lull' ? ['Sadge'] : ['LULW', 'peepoClap'],
    questions: Math.random() < 0.4 ? QUESTIONS : [],
    baseline: { low: BASELINE.hype.low, high: BASELINE.hype.high },
    vs_baseline: {
      hype: x(hype, BASELINE.hype.avg),
      msgs_per_min: x(msgs, BASELINE.msgs_per_min),
      unique_chatters: x(chatters, BASELINE.unique_chatters),
      sentiment: x(sentiment, BASELINE.sentiment),
    },
    annotations: ANNOTATION_SCRIPT.filter((a) => a.t <= t).map((a) => ({
      ts: new Date(started + (loopBase + a.t) * 1000).toISOString(),
      t: Math.round(loopBase + a.t),
      label: a.label,
      hype: Math.round(hypeAt(a.t)),
    })),
    shoutouts: SHOUTOUT_SCRIPT.filter((s) => s.t <= t).map((s, i) => ({
      id: `so-${loop}-${i}`,
      ts: new Date(started + (loopBase + s.t) * 1000).toISOString(),
      username: s.username,
      kind: s.kind,
      detail: s.detail,
    })),
  };
}

const POLL: Omit<ActionEvent, 'type' | 'ts' | 'status'> = {
  id: 'act-poll',
  kind: 'poll',
  trigger: 'lull',
  reason: 'Chat quiet for 90s — msgs/min down 62%',
  title: 'Next map: let chat pick?',
  options: ['Ascent', 'Bind', 'Haven', 'Lotus'],
  auto_fire: true,
};

const TRIVIA: Omit<ActionEvent, 'type' | 'ts' | 'status'> = {
  id: 'act-trivia',
  kind: 'trivia',
  trigger: 'topic_shift',
  reason: 'Topic shifted to “rank” — 14 questions in 2min',
  title: 'Trivia: What was his peak rank?',
  options: ['Diamond', 'Immortal', 'Radiant', 'Ascendant'],
  auto_fire: false,
};

export function startMockStream(onEvent: Handler): () => void {
  const started = Date.now();
  let lastLoop = -1;
  let fired: Record<string, boolean> = {};
  let tick = 0;

  const fireOnce = (key: string, fn: () => void) => {
    if (!fired[key]) {
      fired[key] = true;
      fn();
    }
  };

  const interval = setInterval(() => {
    tick++;
    const elapsed = (Date.now() - started) / 1000;
    const t = elapsed % LOOP_S;
    const loop = Math.floor(elapsed / LOOP_S);
    if (loop !== lastLoop) {
      lastLoop = loop;
      fired = {};
    }

    // chat
    const n = chatRate(t);
    for (let i = 0; i < n; i++) onEvent(makeChat(t));

    // insight every 2s
    if (tick % 5 === 0) onEvent(makeInsight(t, elapsed, started, loop));

    // scripted actions
    if (t >= 30) fireOnce('poll', () =>
      onEvent({ ...POLL, type: 'action', ts: new Date().toISOString(), status: 'suggested' }));
    if (t >= 38) fireOnce('poll-live', () =>
      onEvent({ ...POLL, type: 'action', ts: new Date().toISOString(), status: 'live' }));
    if (t >= 52) fireOnce('poll-result', () => {
      const result: ActionResult = {
        type: 'result',
        action_id: 'act-poll',
        votes: { Ascent: 41, Bind: 18, Haven: 27, Lotus: 33 },
        engagement_delta: 0.38,
      };
      onEvent(result);
    });
    if (t >= 70) fireOnce('trivia', () =>
      onEvent({ ...TRIVIA, type: 'action', ts: new Date().toISOString(), status: 'suggested' }));
  }, 400);

  return () => clearInterval(interval);
}
