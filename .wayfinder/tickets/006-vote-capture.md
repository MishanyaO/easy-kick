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
