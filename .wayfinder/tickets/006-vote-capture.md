# 006 — Vote capture and the poll card

Parent: [map](../map.md) · Label: `wayfinder:grilling` · Status: **open** · Assignee: _unclaimed_
Blocked by: [002](002-kick-chat-send-research.md), [003](003-event-contract.md)

## Question

`debate → poll` is the only state where a *viewer* does something, which is the half of
the challenge statement about "interactive chat-based features." It is also the most
expensive path. Settle how a vote actually happens.

`VoteBars` currently simulates incoming votes client-side — that is fake and must be
replaced by votes parsed from the real chat stream.

Decide:

1. **The voting mechanism.** Chat-parsed commands (`!1` / `!2`), keyword matching on the
   two camps' own words, or a Kick-native poll if [002](002-kick-chat-send-research.md)
   finds one. Chat-parsed is the safe default and works identically in sim.
2. **Dedupe.** One vote per user, first vote wins or last vote wins, and what happens to
   a user who votes twice — silently ignored, or visibly counted once.
3. **The poll's lifetime.** How long it stays open, whether it closes on a timer or on a
   rate of incoming votes trailing off, and how that interacts with the 2-minute
   after-window in [005](005-verdict-semantics.md).
4. **What the card shows** across its lifetime: live counts as they arrive, the two camp
   labels the LLM generated, and the final split. Plus the empty case — a poll that gets
   two votes total is a real outcome and should not look broken.
5. **Whether poll participation is itself a measured metric.** Vote count is a cleaner
   engagement signal than rpm for this state — decide whether the verdict for a debate
   action headlines votes instead of deltaRpm.
6. **How the simulator produces a plausible vote distribution** without faking it — the
   sim fakes the chat, never the detection or the counting.


## Revision 2026-07-27 — the mechanism shipped; the rules did not

`Controller._votes` in [server/src/easy_kick/controller.py](../../server/src/easy_kick/controller.py)
already counts votes off the real chat stream — it tallies exact matches against the
card's `options` over the decision window, and `ResultFrame.votes` carries the tally to
the frontend. So questions 1 and 6 are answered: chat-parsed, identically in sim and
live, and the simulator fakes the chat but never the counting.

What the implementation does *not* have, which is what this ticket still owns:

1. **No dedupe at all.** One viewer typing `1` twenty times is twenty votes. Q2 is
   therefore live and load-bearing, not a detail — a single spammer can invert a poll on
   stage. The safe key is `sender.user_id`, which [002](002-kick-chat-send-research.md)
   found and which the `chat` frame still does not carry (`types.ts` notes the gap).
2. **Exact-match only.** The tally keys off `card.options`, currently the literal strings
   in `controller.py`'s `Card` for `CHAT_POLL`. `1)` , ` 1`, `one` and an emote all miss.
   Decide how forgiving the match is — this is cheap to widen and expensive to explain
   on stage when chat votes and the bars stay at zero.
3. **Lifetime is the decision window, implicitly.** Votes are counted over the 60s window
   and no longer. Confirm that is the poll's lifetime, or give the poll its own clock.
4. **Nothing renders it.** `votes` arrives on every `result` frame and no surface reads
   it — not the drawer, not Review. Q4's card does not exist yet, empty state included.
5. **Q5 stands unchanged**: whether a `chat_poll` verdict headlines votes rather than
   participation lift.

**Still needed, still blocked on nothing.** `chat_poll` is one of the three
demo-critical arms (map note 11), and it is the only place a viewer does something.


## Resolution 2026-07-27 — the rules, and the surface

Built and verified against the live gym: a fired poll showed `1: 23 · 2: 24` with
**47 viewers voted**, the two agreeing by construction because the count is of ballots,
not messages.

1. **Mechanism: chat-parsed, confirmed.** No native poll exists ([002](002-kick-chat-send-research.md)),
   so this was never a choice. Identical in sim and live — the gym now fakes only the
   *chat*, never the counting.
2. **Dedupe: one viewer, one vote, keyed on `user_id`.** `sender.user_id` now rides the
   chat frame (`ChatEventOut.user_id`), and `Controller._ballots` keys ballots on it,
   falling back to the username when Kick omits it. **First vote wins** — chat is a
   conversation, and `2 … actually 1` is a person arguing, not revising a ballot;
   last-wins hands the poll to whoever talks most. A second vote is silently ignored
   rather than visibly rejected: telling 200 people they mis-voted is noise, and the
   count is the thing that matters.
3. **Matching is forgiving, but anchored.** `!1`, `1)`, ` 1 ` and `1 yes obviously` all
   count; `is 1 better than 2?` does not. The option has to lead the message, or every
   mention of a number becomes a ballot. Exact-string matching — what shipped in PR #5 —
   counted none of those, so a poll could read zero while chat was visibly answering it.
4. **Lifetime is the decision window**, and the card now sees it happen: the controller
   publishes a **`controller.poll`** frame every tick while a fired poll is open, carrying
   the running tally, the distinct voter count and a countdown. Votes previously existed
   only on the closed `result`, so the one moment a viewer is doing something was the one
   moment the streamer could not see it. Nothing is published while a card is still
   awaiting approval — chat has been asked nothing yet.
5. **The empty and thin cases are designed.** Zero votes reads "no votes yet — the prompt
   is in chat". **Percentages are withheld below 10 votes**: a two-vote poll is a real
   outcome, but "100% yes" off two ballots is a lie told confidently. Raw counts are honest
   at any N, and the line says "too few to read as a split".
6. **The simulator answers polls without faking them.** Personas carry a fixed `lean`, so a
   world has camps rather than a coin flip; a persona who responds to the arm types an
   option instead of chatter, and repeat-typers exist on purpose so the dedupe is exercised
   by the world rather than only by tests. A negative-gain persona — one the prompt landed
   badly on — does not answer at all.

Q5 (**should a `chat_poll` verdict headline votes instead of participation lift**) is
deliberately still open. The ledger now shows the split beside the lift, which is enough to
judge it against real windows; deciding it before that data exists would be guessing.

Five tests cover the rules, two cover the world: `test_controller.py` (dedupe, first-wins,
punctuation, tick-publishing, approval-gating) and `test_gym.py` (polls get answered, and
an optionless arm leaves chat talking normally).
