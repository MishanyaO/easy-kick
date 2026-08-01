// Frame shapes as the backend ACTUALLY emits them (captured from /stream, not from the
// spec). Where the spec and the wire disagree, the wire wins and the gap is commented.

export type Arm =
  | 'nothing' | 'emote_rally' | 'chat_poll' | 'quiz' | 'chat_digest' | 'prediction'
  | 'click_rally';
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
  is_live?: boolean | null;
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
  status: 'suggested' | 'sending' | 'live' | 'closed' | 'dismissed';
  // contract v2 asks for expires_in_s — not on the wire yet
};

/** Emitted when a decision window closes. `outcome` includes 'skipped' (a `nothing` arm). */
export type ResultFrame = {
  type: 'result';
  action_id: string;
  state: ChatState;
  arm: Arm;
  origin: 'autonomous' | 'approved' | 'manual' | 'scenario';
  votes: Record<string, number>;
  engagement_delta: number; // matched-control lift, in participation points
  reward: number; // [0,1] after the logistic squash
  lift_naive: number; // the biased before/after estimator, kept for comparison
  lift_true?: number; // gym only — twin-world ground truth
  /** Why this window cannot be read as an effect, in plain words. Null when it can. */
  contaminated: string | null;
  /** Clean same-state, same-width windows the control averaged. 0 means there was none. */
  controls: number;
  /** Viewers silent before this window who talked inside it — reach, not net headcount. */
  activated: number;
  /** Distinct viewers who answered, when the arm asked something. */
  voters: number;
  /** How long this window stayed open. Per-arm, so not every row is the same width. */
  window_s: number;
  outcome: 'fired' | 'dismissed' | 'skipped' | 'railed' | 'send_failed';
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

/** One Thompson draw, as it happened. The samplers' numbers are the interesting part: the
 *  policy is "roll one number out of each belief, play the highest", and a wide belief
 *  rolls wild — which is the entire reason the thing explores at all. */
export type LastDecision = {
  state: ChatState;
  /** One Beta draw per *eligible* arm — rails can take arms off the table, so this is a
   *  partial record and code that indexes it must expect holes. */
  samples: Partial<Record<Arm, number>>;
  chosen: Arm;
  propensity: number;
  eligible?: Arm[];
  /** The control was taken deliberately, not won. A fixed share of decisions are reserved
   *  as clean quiet windows — without them there is nothing to measure a lift against. */
  forced_control?: boolean;
};

export type BanditFrame = {
  type: 'bandit';
  decisions: number;
  posteriors: Posterior[];
  last_decision?: LastDecision;
};

export type ControllerResetFrame = {
  type: 'reset';
};

/** The backend stopped its own clock on a beat worth looking at (see the scenario's
 *  showcase). It is an ordinary pause — Start resumes it — but the dashboard freezes the
 *  click map on it, so what is being talked about does not fade out mid-sentence. */
export type HoldFrame = {
  type: 'hold';
  reason: string;
};

/**
 * Taps on the video, batched — the click map over Stream Preview is drawn from these.
 *
 * Ephemeral on purpose, and the one frame that is not part of the session record: clicks
 * are never written to the event store (a tap is not a chat event and must not become one
 * in the measurement) and never kept in the replayable controller history (a tab opened
 * late would otherwise repaint an hour of somebody else's attention as if it were now).
 * That also means no `seq` — which is why `useGambit` handles these alongside chat, ahead
 * of its sequence gate.
 */
/** One tap, in normalized [0,1] frame coordinates, stamped on arrival: the map fades a
 *  blob out by how long ago it landed, and the wire carries no clock we could use for
 *  that — the stream runs on virtual time and can be sped up. */
export type ClickPoint = { x: number; y: number; born: number };

/** How long a tap takes to fade from full intensity to gone. The map is "where the room is
 *  looking", not "where it has ever looked", so a point is only worth keeping while it is
 *  still being drawn: short enough that the frame goes clean on its own once a rally is
 *  over, long enough that a whole rally is still on screen when the run holds on it —
 *  which at 50× — the speed the demo is actually run at — is under a second after the last
 *  tap lands. Both ends of that matter now that a rally is the only thing that ever fills
 *  the map: too long and the picture outstays the moment it belongs to, too short and it
 *  has drained before the hold arrives to freeze it. Tuned for 50×; at 1× or 5× a rally
 *  will visibly drain behind its own taps. */
export const CLICK_FADE_MS = 1000;

export type ClicksFrame = {
  type: 'clicks';
  ts: string;
  /** Normalised `[x, y]` over the video frame, so they survive any resize of the panel. */
  points: [number, number][];
};

export type ControllerFrame = (
  | ContextFrame
  | ActionFrame
  | ResultFrame
  | BanditFrame
  | PollFrame
  | DigestFrame
  | HoldFrame
  | ControllerResetFrame
) & {
  /** Monotonic within one backend-owned gym/live session. */
  seq: number;
  session_id: string;
};

export type Frame =
  | ChatFrame
  | ClicksFrame
  | ControllerFrame;

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

/** What the verdict means for the stream, said the way a streamer would say it. */
export const VERDICT_BLURB: Record<VerdictLabel, string> = {
  Worked: 'more of your viewers started talking',
  Neutral: 'chat carried on much as it was',
  Backfired: 'fewer of your viewers talked after it',
  "Can't tell": 'this one cannot be read as an effect',
};

/**
 * The product name for a tactic. `arm` is the wire name and it leaks — `emote_rally` in a
 * ledger a streamer reads is us showing them our variable names.
 */
export const ARM_LABEL: Record<Arm, string> = {
  nothing: 'Stayed quiet',
  emote_rally: 'Emote rally',
  chat_poll: 'Poll',
  quiz: 'Quiz',
  chat_digest: 'Chat digest',
  prediction: 'Prediction',
  click_rally: 'Click rally',
};

/** What the tactic actually did in chat, for the expanded row. */
export const ARM_BLURB: Record<Arm, string> = {
  nothing: 'held back and let chat run on its own',
  emote_rally: 'asked chat to spam an emote together',
  chat_poll: 'put a question to chat and counted the replies',
  quiz: 'asked chat something with a right answer',
  chat_digest: 'summarised what chat was on about — for you, never posted',
  prediction: 'opened a call for chat to back a side',
  click_rally: 'asked chat to tap the stream, and drew what they pointed at',
};

/** The chat state as a clause in a sentence, rather than a chip. */
export const STATE_PHRASE: Record<ChatState, string> = {
  lull: 'chat had gone quiet',
  steady: 'chat was ticking along',
  spike: 'chat was already going off',
};

/** Who decided to send it, in the streamer's terms. Short: it sits in a byline. */
export const ORIGIN_LABEL: Record<ResultFrame['origin'], string> = {
  autonomous: 'sent automatically',
  approved: 'you approved it',
  manual: 'you sent it',
  scenario: 'simulated session',
};

/**
 * A lift in participation points read back as people.
 *
 * Points are the right unit to compare windows in and the wrong unit to feel anything
 * about: "+1.8 pts" and "about 17 more people talking" are the same fact, and only one of
 * them is worth putting on a stream deck. Null when there is no viewer count to multiply
 * by — inventing a denominator to get a friendlier sentence is the exact species of
 * confident nonsense the rest of this UI refuses to print.
 */
export function peopleMoved(delta: number, viewers: number | null | undefined): string | null {
  if (!viewers) return null;
  const n = delta * viewers;
  // Under half a person is not a result, and "0 more people talking" is a worse way of
  // saying "nothing moved" than the verdict already does.
  if (Math.abs(n) < 0.5) return null;
  const c = Math.round(Math.abs(n));
  return `about ${c} ${n > 0 ? 'more' : 'fewer'} ${c === 1 ? 'person' : 'people'} talking`;
}

/** The same conversion as `peopleMoved`, as a signed count for a dense ledger row. */
export function peopleShort(delta: number, viewers: number | null | undefined): string | null {
  if (!viewers) return null;
  const n = delta * viewers;
  if (Math.abs(n) < 0.5) return null;
  const c = Math.round(Math.abs(n));
  return `≈ ${n > 0 ? '+' : '−'}${c} ${c === 1 ? 'person' : 'people'}`;
}

/** "Time Live" style elapsed clock — the gym's virtual second, not the wall clock. */
export function clock(s: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(s / 3600)}:${p((s % 3600) / 60)}:${p(s % 60)}`;
}

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

/**
 * Below this many pulls the sampler ignores a cell and draws the flat prior instead —
 * mirrors `MIN_PULLS` in bandit.py. A cell under it has evidence but is not yet trusted,
 * and showing its mean as if it were a finding is how a demo ends up claiming a result off
 * a single window.
 */
export const MIN_PULLS = 3;

/**
 * How unsure a Beta(α, β) still is.
 *
 * The mean is what Gambit believes; this is how far that belief would move if the next
 * window disagreed. It is the half of the picture a table of means drops, and the half
 * that makes learning visible — the number shrinks as evidence lands.
 */
export const betaSd = (alpha: number, beta: number) =>
  Math.sqrt((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)));

/** One (state, arm) cell of the policy table. */
export const cellKey = (state: ChatState, arm: Arm) => `${state}|${arm}`;

/** Lanczos g=7, n=9 — the usual coefficients, accurate to ~15 digits.
 *
 *  No reflection branch for z < 0.5: α and β are seeded at the 1.0 prior and only ever
 *  decay back toward it (`PRIOR` in bandit.py), so nothing here is ever called below 1. */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lgamma(z: number): number {
  const w = z - 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (w + i);
  const t = w + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (w + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * The Beta(α, β) density at x, in logs.
 *
 * The normalising 1/B(α, β) is the whole reason this exists rather than the one-line
 * shape x^(α−1)(1−x)^(β−1). Drop it and a *narrower* posterior draws a *lower* peak — the
 * story exactly backwards, since a sharpening curve is the thing worth looking at.
 */
export const betaLogPdf = (x: number, alpha: number, beta: number) =>
  (alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x)
  + lgamma(alpha + beta) - lgamma(alpha) - lgamma(beta);

/** Standard normal CDF — Abramowitz & Stegun 26.2.17, accurate to ~7e-8. */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * P(this tactic scores better than that one) — a real probability, unlike either posterior
 * mean on its own.
 *
 * A Beta mean here is the expected value of the *reward*: a logistic squash of relative
 * lift, minus the cost charged for interrupting. It is the number the sampler runs on and
 * it is not readable — "0.62" answers no question anybody asked. What is readable is the
 * comparison the table exists to make, and that comparison has an honest unit: how sure
 * Gambit is that one arm beats another, given everything it has seen.
 *
 * Normal approximation rather than the exact Beta sum: with a handful of pulls the two
 * agree to well under the precision anyone reads off a chart, and it stays exact where it
 * matters most — two identical posteriors give exactly 0.5, so an untouched cell reads as
 * the coin flip it is.
 */
export type Belief = { alpha: number; beta: number };

export function pBeats(x: Belief, y: Belief): number {
  const mx = x.alpha / (x.alpha + x.beta);
  const my = y.alpha / (y.alpha + y.beta);
  // Exact where it matters most, rather than the approximation's 0.4999999995: two
  // untouched cells have to read as a dead-level coin flip and not as a hair's advantage.
  if (mx === my) return 0.5;
  const spread = Math.hypot(betaSd(x.alpha, x.beta), betaSd(y.alpha, y.beta));
  if (spread < 1e-9) return Number(mx > my);
  return phi((mx - my) / spread);
}

/** Above this Gambit is calling it; below the mirror of it, it is calling the other way.
 *  In between is "too close to say", which the map has to be able to print. */
export const SURE = 0.7;

export const STATE_LABEL: Record<ChatState, string> = {
  lull: 'LULL',
  steady: 'STEADY',
  spike: 'SPIKE',
};

/** Participation as a percentage, the way a streamer reads it. */
export const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
/** A lift in participation points, signed — except at zero, where a sign is a lie either
 *  way and `-0.0 pts` reads as a bug rather than as "nothing moved". */
export const points = (v: number, dp = 1) => {
  const n = v * 100;
  if (Math.abs(Number(n.toFixed(dp))) === 0) return `${(0).toFixed(dp)} pts`;
  return `${n > 0 ? '+' : ''}${n.toFixed(dp)} pts`;
};
