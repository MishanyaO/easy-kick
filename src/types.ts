export type ChatEvent = {
  type: 'chat';
  id: string;
  ts: string;
  username: string;
  text: string;
  emotes: string[];
  is_sub: boolean;
  is_mod: boolean;
};

export type Question = {
  id: string;
  text: string;
  asked_by: string;
  count: number;
  score: number;
};

export type Annotation = {
  ts: string;
  t: number; // seconds since stream start, aligns with timeline x-axis
  label: string;
  hype: number;
};

export type Shoutout = {
  id: string;
  ts: string;
  username: string;
  kind: 'first_time' | 'returning' | 'new_sub';
  detail: string;
};

export type InsightEvent = {
  type: 'insight';
  ts: string;
  window_s: number;
  msgs_per_min: number;
  unique_chatters: number;
  sentiment: number;
  hype: number;
  spike: boolean;
  lull: boolean;
  top_topics: string[];
  top_emotes: string[];
  questions: Question[];
  baseline: { low: number; high: number };
  vs_baseline: { hype: number; msgs_per_min: number; unique_chatters: number; sentiment: number };
  annotations: Annotation[];
  shoutouts: Shoutout[];
};

export type ActionEvent = {
  type: 'action';
  id: string;
  ts: string;
  kind: 'poll' | 'trivia' | 'recap' | 'nudge' | 'clip';
  trigger: 'spike' | 'lull' | 'topic_shift' | 'manual';
  reason: string;
  title: string;
  options: string[];
  body?: string;
  auto_fire: boolean;
  status: 'suggested' | 'live' | 'closed' | 'dismissed';
};

export type ActionResult = {
  type: 'result';
  action_id: string;
  votes: Record<string, number>;
  engagement_delta: number;
};

export type StreamEvent = ChatEvent | InsightEvent | ActionEvent | ActionResult;
