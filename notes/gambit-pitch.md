# Gambit

A chat co-host that decides when to intervene, measures whether it helped, and learns what
works in a particular channel.

Easygo Mini Hackathon, Challenge 2. Technical detail is in `gambit-engineering.md`.

---

## The problem

Chat is where a streamer's audience turns into regulars, so most streamers run a bot to keep
it moving. Established bots such as Nightbot, Fossabot, Moobot and Streamlabs Cloudbot are
commonly configured with rules and timers: post every N minutes, whether or not the moment is
right. That setup does not measure whether the message helped, so neither the bot nor the
streamer learns from it.

The newer AI chat bots add sentiment scoring and summaries. That is analysis — it describes
what happened. It does not decide what to do next.

Ad serving, feed ranking and notification timing pick their moments by measuring outcomes.
Many chat bots still run on rules and schedules. That gap is the whole idea.

## What a streamer gets

At the end of a stream, three sentences about their own channel:

> Across six comparable lull moments, poll windows were 1.4 percentage points above quiet ones.
> During spikes, staying quiet performed best.
> This is an early signal; more streams will narrow the estimate.

Most bots do not give a streamer this outcome-based feedback. Everything below is how we earn
the right to say it.

The number underneath is participation rate — what fraction of the people watching are
actually talking. A typical channel sits at a few percent. That is the number we move, and
it is the one a streamer already has intuition about.

The first user is a streamer or moderator on a mid-sized channel: enough chat to learn from,
but too much to judge every intervention manually while running the stream.

## How it works

Gambit reads the state of chat, picks an intervention or deliberately picks nothing, then
measures what happened over the next 60 seconds against a comparable moment where it stayed
quiet. It keeps a probability distribution over how well each intervention works in each chat
state, and updates after every decision.

Five arms, three chat states, fifteen distributions. The policy is about 80 lines of Python
with no dependencies. It is small deliberately — the algorithm is standard, the measurement
is the part that is missing from the market.

The interventions all run through Kick's chat API, so they work today with no unreleased
endpoints: an emote rally ("drop a 🔥 if you saw that"), a chat-native poll where the bot
asks and counts the replies, relaying a question several people are asking, and welcoming a
newcomer. They are chosen to span the effort a viewer has to spend to join in, because that
is what decides who converts. The demo-critical set is smaller: a poll, an emote rally and
`nothing`.

Three decisions do most of the work.

**Doing nothing is a real option.** `nothing` is a first-class arm with its own posterior, and
every intervention is charged a small fixed cost. So an intervention has to earn its
interruption, and staying quiet has to beat the alternatives on evidence. The result is a bot
biased toward silence, and one that can learn that interrupting a hype spike makes things
worse. A timer-based bot has no way to have an opinion about not acting.

**We measure how many distinct people are talking, as a share of viewers.** Raw messages per
minute is confounded by whatever is happening on stream, gameable by spam, and treats five
people flooding the same as fifty people joining in. Optimising it produces an annoying bot.

**Reward is lift against a control, never a level.** Chat spikes because someone hit a clutch
shot, not because our poll was good. So we compare against similar moments in the same chat
state where we stayed quiet. The obvious alternative — compare to the 60 seconds before — is
biased in a way we can name: you intervene *because* things dipped, so mean reversion flatters
you. We implemented both and we show the difference.

## Why the numbers hold up

Autonomous decisions are randomized from the policy, every choice probability is logged, and
`nothing` keeps a minimum allocation so we retain a control. We compare outcomes within the
same observed chat state and can use the logged probabilities for stronger estimates later.
The matched comparison reduces a known bias; it is not proof that every remaining difference
came from the bot.

Streamer-approved actions are reported separately. Approval is a human choice, not randomized,
so those outcomes are useful product feedback but not clean causal evidence.

What we built to test the loop is a simulated chat environment: a synthetic audience with
hidden preferences, plus a scripted content arc that moves chat independently of the bot. It
is deterministic given a seed and can be forked mid-run —
so at any decision point we copy the world, fire in one copy, stay silent in the other, and
the difference is a twin-world estimate unavailable on a real stream.

The bandit never sees any of it. It trains only on the estimate it would have to use on live
Kick traffic. The separation is structural rather than a promise: the simulator writes events
into the same event store real Kick webhooks write into, and the policy reads only from the
store.

## What the simulation does and does not show

Worth being straight about, because it is the first thing we would ask.

Our simulated chatters have hidden preferences over (chat state × intervention), and our model
is a table over (chat state × intervention). The world and the model share a shape. So the
simulator can show that the bandit learns a world of that shape; it cannot show that real chat
has that shape. On Kick, response also depends on the game, on what the streamer just said, on
whether the poll question was any good.

So we make two separate claims, and only one of them leans on the simulator:

- **The estimator claim.** The naive before-and-after measure is biased upward, and matching
  against comparable quiet moments removes most of that bias in the gym. On live traffic it
  remains a directional estimate until we have enough randomized, propensity-aware data.
- **The learning claim.** In a world where the model is well specified, Gambit beats a timer,
  random, and staying silent, averaged over ~100 randomly sampled worlds with confidence
  bands. That is a best-case simulation result, not evidence of live lift.

We would rather show a narrow claim we can defend than a wide one we cannot.

## Who is in control

Autonomy is set per intervention, according to what it spends. After one setup consent, an
emote rally can run automatically because it costs one chat line. A poll occupies more of
chat's attention, so it starts as a suggestion. A prediction stakes viewers' Channel Points,
so it always asks — that is not ours to spend.

When a streamer dismisses a suggestion, that tells us something a timer bot never finds out.
It is not evidence that chat would have disliked it; it is evidence that this streamer does
not want it. We keep those as two separate signals, because the interesting case is when they
disagree: chat responds well to something and the streamer kills it every time, so we stop
suggesting it. Approved actions are also kept out of the autonomous-action causal estimate.

Caps, cooldowns, quiet hours and the kill switch are set by the streamer and never learned.
The bandit optimises inside those limits and never sets them.

## Why Kick specifically

The Kick-native signals are already in our reward function. Kicks gifted and reward
redemptions are event types we ingest today, so tipping and Channel Points count as engagement
alongside messages. Predictions are a Kick-native stretch arm, not a dependency of the demo.

The longer-term version only works if you own the platform. A single stream produces maybe
20–60 interventions, nowhere near enough to learn from. Five hundred concurrent channels
produce thousands an hour. Pool them hierarchically — global prior, then channel archetype
keyed on category, then this channel — and a brand-new streamer starts with a policy that
already works instead of weeks of bad exploration. Every stream makes every other stream's bot
better. Kick has a natural advantage here because it can learn across the platform rather than
only within one installed channel.

That is roadmap, not the hackathon build. But it is why this is a platform capability rather
than a bot.

## The demo (3 minutes)

1. **The problem, 15s.** A timer posts without knowing whether the moment is right.
2. **Head to head, 65s.** Two chat panels, same seed, same accelerated simulated stream, same
   viewers. One runs a 15-minute timer, the other runs Gambit. Two live counters show what
   share of viewers are talking. During a spike, the timer posts and Gambit stays quiet — with
   the reason on screen.
3. **Compressed learning, 30s.** Fast-forward repeated decisions, then show one insight with
   its evidence count.
4. **The evidence, 25s.** One policy comparison chart and one sentence on the estimator:
   matching removes most of the named bias in the gym.
5. **It's real, 20s.** Live Kick channel, signed webhooks and OAuth. Send one real chat
   intervention; the live segment proves integration, not its 60-second outcome.

Fallbacks in order: live Kick, then simulator, then recorded video. Have all three and test
the projector.

## What we are deliberately not doing

We do not write to real Kick chat without permission — interventions that spend anything
appear as a card the streamer confirms. Partly that is demo risk, but mostly predictions stake
viewers' Channel Points and streamers should have a veto over that.

No sentiment model, no neural bandit, no database. Three hand-bucketed chat states rather than
a continuous feature vector. Nothing is persisted, which is both the repo convention and a
reasonable position on handling other people's chat messages. Each of those is a deliberate cut
with an upgrade path, not something we ran out of time for.

## Questions we expect

**AI chat bots already do proactive interventions.** They intervene. The distinction is the
outcome-measurement and learning loop, not the generated message.

**Your simulator is circular.** Partly, and we say where. See the section above — the
estimator comparison is a result inside the gym, and the learning result is a best-case result
under a well-specified simulated world.

**How do you know it is your bot and not the gameplay?** For autonomous actions, assignment is
randomized and logged, with a minimum allocation to `nothing`. Matching on chat state reduces
variance and a known mean-reversion bias; propensity-aware estimates are the stronger
production method. Human-approved actions are reported separately.

**Won't this spam my chat?** It is biased toward silence by design — every intervention is
charged a cost and staying quiet competes on the same footing. Plus cooldowns, hourly caps,
per-intervention autonomy settings and a kill switch.

**Why a bandit and not reinforcement learning?** Actions do affect future state, so strictly
this is an MDP. But with roughly 40 decisions per stream, RL credit assignment has no chance.
The myopic bandit is a deliberate bias-variance choice and we know which approximation we made.

**Everyone here has an LLM writing poll questions.** So do we, for the copy. The hard part is
not writing the poll, it is knowing whether to post it. That is where the work went, and it is
why the LLM sits outside the learning loop — if it is slow or fails, the copy gets worse and
nothing else breaks.

## The short version

Chat bots fire on timers and nobody checks whether it helped. Gambit reads the state of chat,
picks an intervention or picks nothing, measures the change in what share of viewers are
talking against comparable quiet moments, and updates. Across repeated decisions it develops
early channel-specific signals about what works and when silence is better. It reports those
signals with the amount of evidence behind them.
