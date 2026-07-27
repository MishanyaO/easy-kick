# 001 — Confirm the Kick app's chat-write scope

Parent: [map](../map.md) · Label: `wayfinder:task` · Status: **open** · Assignee: _unclaimed_
Blocked by: —

## Question

Nothing to decide — this is manual work that unblocks a decision. The registered Kick app's
scopes are unknown, and whether it can post to chat determines whether the ACT step is real
(standing constraint 1) or has to degrade.

Establish, and record as facts on this ticket:

- Which scopes the existing Kick app currently holds (check `server/.env`, the Kick
  developer settings page, and `GET /auth/status`).
- Whether a chat-write scope (`chat:write` or Kick's equivalent) is among them.
- If not: what re-authorization costs — a scope change on the app, a fresh
  `/auth/login` round trip, a separate bot account, or all three.
- Whether posting happens as the broadcaster or as a bot identity, and whether that
  choice is ours to make.

Record the answer even if it's "no write scope, needs re-auth" — that outcome is what
002 and 003 need to plan against, and it is not a blocker to charting them.


## Revision 2026-07-27 — unchanged, and now the highest-priority open ticket

Nothing here has been answered, and two things have raised its stakes since it was
charted:

- **The send path is written and waiting.** `KickAPI.post_chat` in
  [server/src/easy_kick/kick_api.py](../../server/src/easy_kick/kick_api.py) posts to
  `/chat` as `type: "bot"` and its docstring names the scope it needs — `chat:write`.
  So this is no longer research feeding a design; it is the one unknown between a
  working ACT step and a demo that can only run in sim.
- **The echo-back test rides along.** [002](002-kick-chat-send-research.md) established
  that echo-back is undocumented, so the five-minute empirical test — send one line,
  watch whether `chat.message.sent` returns it — happens the moment a write scope is
  confirmed. Record the result here; `observed_in_feed` is nullable precisely because
  nobody has run it.

Still unclaimed. It needs a person with access to the Kick developer settings page, not
a decision.
