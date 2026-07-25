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

/** One intervention the controller can choose. `nothing` is a real arm and is scored. */
export type Arm =
  | 'nothing'
  | 'emote_rally'
  | 'chat_poll'
  | 'question_relay'
  | 'shoutout'
  | 'prediction';

/** Chat volume relative to this channel's own rolling baseline. */
export type ChatState = 'lull' | 'steady' | 'spike';

/** How much rope the streamer gives one arm. Human-set, never learned. */
export type Autonomy = 'auto' | 'ask' | 'off';

export type ActionEvent = {
  type: 'action';
  id: string;
  ts: string;
  kind: Arm;
  trigger: 'spike' | 'lull' | 'steady' | 'topic_shift' | 'manual';
  state: ChatState;
  propensity: number; // P(this arm wins) when it was picked — logged for off-policy eval
  autonomy: Autonomy;
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
  state: ChatState;
  arm: Arm;
  votes: Record<string, number>;
  engagement_delta: number; // matched-control lift, in participation points
  reward: number; // [0,1] after the logistic squash
  lift_naive: number; // the biased pre/post estimator, kept for the comparison
  lift_true?: number; // gym only — never present on live Kick
  outcome: 'fired' | 'skipped' | 'dismissed' | 'railed';
};

export type BanditFrame = {
  type: 'bandit';
  ts: string;
  decisions: number;
  posteriors: {
    state: ChatState;
    arm: Arm;
    alpha: number;
    beta: number;
    mean: number;
    pulls: number;
  }[];
  last_decision?: {
    state: ChatState;
    samples: Record<Arm, number>;
    chosen: Arm;
    propensity: number;
  };
};

export type ContextFrame = {
  type: 'context';
  viewer_count: number | null;
  category: string | null;
  participation: number; // unique chatters / viewers
  uptime_s: number;
  streamer_speaking?: boolean;
};

export type StreamEvent =
  | ChatEvent
  | InsightEvent
  | ActionEvent
  | ActionResult
  | BanditFrame
  | ContextFrame;
