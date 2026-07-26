// Frame shapes as the backend ACTUALLY emits them (captured from /stream, not from the
// spec). Where the spec and the wire disagree, the wire wins and the gap is commented.

export type Arm =
  | 'nothing' | 'emote_rally' | 'chat_poll' | 'question_relay' | 'shoutout' | 'prediction';
export type ChatState = 'lull' | 'steady' | 'spike';
export type Autonomy = 'auto' | 'ask' | 'off';

export type ChatFrame = {
  type: 'chat';
  id: string;
  ts: string;
  username: string;
  text: string;
  emotes: string[];
  is_sub: boolean;
  is_mod: boolean;
  // contract v2 asks for user_id / sub_months / replies_to — not on the wire yet
};

export type ContextFrame = {
  type: 'context';
  viewer_count: number | null;
  category: string | null;
  participation: number; // unique chatters / viewers — the primary metric
  uptime_s: number;
  streamer_speaking?: boolean;
};

export type ActionFrame = {
  type: 'action';
  id: string;
  ts: string;
  kind: Arm;
  trigger: string;
  state: ChatState;
  propensity: number;
  autonomy: Autonomy;
  reason: string; // "spike: 5.1% of viewers talking"
  title: string;
  body: string; // the line that goes into chat
  options: string[];
  auto_fire: boolean;
  status: 'suggested' | 'live' | 'closed' | 'dismissed';
  // contract v2 asks for expires_in_s — not on the wire yet
};

/** Emitted when a decision window closes. `outcome` includes 'skipped' (a `nothing` arm). */
export type ResultFrame = {
  type: 'result';
  action_id: string;
  state: ChatState;
  arm: Arm;
  votes: Record<string, number>;
  engagement_delta: number; // matched-control lift, in participation points
  reward: number; // [0,1] after the logistic squash
  lift_naive: number; // the biased before/after estimator, kept for comparison
  lift_true?: number; // gym only — twin-world ground truth
  outcome: 'fired' | 'dismissed' | 'skipped' | 'railed';
  // contract v2 asks for label / contaminated / replies / held_s / raiders — not yet
};

export type Posterior = {
  state: ChatState;
  arm: Arm;
  alpha: number;
  beta: number;
  mean: number;
  pulls: number;
};

export type BanditFrame = {
  type: 'bandit';
  decisions: number;
  posteriors: Posterior[];
  last_decision?: {
    state: ChatState;
    samples: Record<Arm, number>;
    chosen: Arm;
    propensity: number;
  };
};

export type Frame = ChatFrame | ContextFrame | ActionFrame | ResultFrame | BanditFrame;

/** UI vocabulary derived from his numbers — the backend does not send these. */
export type VerdictLabel = 'Worked' | 'Neutral' | 'Backfired' | "Can't tell";

/** Thresholds are placeholders until ticket 005 settles them. Lift is in participation
 *  points, so 0.005 = half a percentage point of the audience starting to talk. */
export const NOISE_BAND = 0.005;

/**
 * `nothing` windows are the CONTROL. Calling a quiet window "Backfired" is nonsense — it
 * only means participation drifted while we did nothing, which is information but not an
 * outcome of an intervention. They get their own group instead of a verdict.
 */
export const isControl = (r: ResultFrame) => r.arm === 'nothing';

export function labelFor(r: ResultFrame): VerdictLabel {
  if (r.outcome === 'dismissed') return "Can't tell";
  if (r.engagement_delta > NOISE_BAND) return 'Worked';
  if (r.engagement_delta < -NOISE_BAND) return 'Backfired';
  return 'Neutral';
}

export const VERDICT_COLOR: Record<VerdictLabel, string> = {
  Worked: 'var(--kick-green)',
  Neutral: 'var(--text-muted)',
  Backfired: 'var(--danger)',
  "Can't tell": 'var(--warn)',
};

export const STATE_LABEL: Record<ChatState, string> = {
  lull: 'LULL',
  steady: 'STEADY',
  spike: 'SPIKE',
};

/** Participation as a percentage, the way a streamer reads it. */
export const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
/** A lift in participation points, signed. */
export const points = (v: number, dp = 1) =>
  `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)} pts`;
