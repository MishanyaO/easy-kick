// Frame shapes as the backend ACTUALLY emits them (captured from /stream, not from the
// spec). Where the spec and the wire disagree, the wire wins and the gap is commented.

export type Arm =
  | 'nothing' | 'emote_rally' | 'chat_poll' | 'quiz' | 'chat_digest' | 'prediction';
export type ChatState = 'lull' | 'steady' | 'spike';
export type Autonomy = 'auto' | 'ask' | 'off';
/** Set before the stream starts. `manual`: fire-rate sliders decide, the bandit never runs.
 *  `auto`: sliders are ignored, Thompson sampling explores freely. */
export type Mode = 'auto' | 'manual';

export type ChatFrame = {
  type: 'chat';
  id: string;
  ts: string;
  username: string;
  /** The stable identity. Null when Kick omits it; `username` is display text, not a key. */
  user_id: string | null;
  text: string;
  emotes: string[];
  is_sub: boolean;
  is_mod: boolean;
  // contract v2 asks for sub_months / replies_to — not on the wire yet
};

/** An open poll, republished every controller tick while its window is running. */
export type PollFrame = {
  type: 'poll';
  ts: string;
  action_id: string;
  arm: Arm;
  question: string;
  options: string[];
  votes: Record<string, number>;
  /** Distinct viewers who voted — one ballot each, deduped server-side. */
  voters: number;
  closes_in_s: number;
};

/** A poll/quiz window's final split, kept around after close until the streamer dismisses
 *  it or a new bot line replaces it — see the `closedPoll` notes in useGambit's reducer. */
export type ClosedPoll = Pick<PollFrame, 'action_id' | 'question' | 'options' | 'votes' | 'voters'>;

export type ContextFrame = {
  type: 'context';
  viewer_count: number | null;
  category: string | null;
  participation: number; // unique chatters / viewers — the primary metric
  unique_chatters: number;
  msgs_per_min: number;
  actions_per_min: number; // comments + reactions (redemptions, gifts) — same window
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
  /** Why this window cannot be read as an effect, in plain words. Null when it can. */
  contaminated: string | null;
  /** Clean same-state windows the matched control averaged. 0 means there was no control. */
  controls: number;
  outcome: 'fired' | 'dismissed' | 'skipped' | 'railed';
  // contract v2 asks for label / replies / held_s / raiders — not yet
};

/** `chat_digest`: a card-only highlight, never posted to chat and never scored. */
export type DigestFrame = {
  type: 'digest';
  ts: string;
  kind: 'chat_digest';
  title: string;
  body: string;
  highlight: { who: string; text: string };
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

export type Frame =
  | ChatFrame | ContextFrame | ActionFrame | ResultFrame | BanditFrame | PollFrame | DigestFrame;

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
  // The backend knows when a window is unattributable — a fire inside the 120s shadow, or
  // no clean control to difference against. Reading a delta as a verdict anyway is how a
  // system reports good news it has not earned.
  if (r.contaminated) return "Can't tell";
  if (r.engagement_delta > NOISE_BAND) return 'Worked';
  if (r.engagement_delta < -NOISE_BAND) return 'Backfired';
  return 'Neutral';
}

/** The plain-words reason a verdict is `Can't tell`, or null. */
export const whyUnattributable = (r: ResultFrame): string | null =>
  r.contaminated ?? (r.outcome === 'dismissed' ? 'you skipped it, so nothing was sent' : null);

export const VERDICT_COLOR: Record<VerdictLabel, string> = {
  Worked: 'var(--kick-green)',
  Neutral: 'var(--text-muted)',
  Backfired: 'var(--danger)',
  "Can't tell": 'var(--warn)',
};

/**
 * Why the bandit picked this arm, in a sentence.
 *
 * `propensity` — the number the card used to print — is the probability the sampler would
 * have landed here again, which is meaningful to the algorithm and to nobody else. The
 * interesting fact is *which move this is*: backing the leader, or spending a decision to
 * learn something. Saying that out loud is what turns a hidden algorithm into a product
 * idea a judge can argue with.
 *
 * Read entirely from frames the UI already has, so it degrades to null rather than lying
 * when the bandit is unavailable (standing constraint 5: it never gates the live path).
 */
export function whyThisArm(
  bandit: BanditFrame | null,
  state: ChatState,
  arm: Arm,
): { mode: 'explore' | 'exploit'; text: string } | null {
  const here = (bandit?.posteriors ?? []).filter((p) => p.state === state);
  const mine = here.find((p) => p.arm === arm);
  if (!mine) return null;

  const tried = here.filter((p) => p.pulls > 0).sort((a, b) => b.mean - a.mean);
  const leader = tried[0];

  if (mine.pulls === 0) {
    return { mode: 'explore', text: `first time trying ${arm} in a ${state}` };
  }
  if (leader && leader.arm === arm) {
    return {
      mode: 'exploit',
      text: `${arm} leads in a ${state} — ${mine.mean.toFixed(2)} over ${mine.pulls} tries`,
    };
  }
  if (leader) {
    return {
      mode: 'explore',
      text: `trying ${arm} (${mine.pulls} tries) over ${leader.arm} (${leader.pulls}) — still learning`,
    };
  }
  return { mode: 'explore', text: `no evidence in a ${state} yet — this is the first read` };
}

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
