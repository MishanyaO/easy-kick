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
