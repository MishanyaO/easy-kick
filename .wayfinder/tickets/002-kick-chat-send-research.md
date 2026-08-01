# 002 — Kick chat-send: echo-back, identity, rate limits

Parent: [map](../map.md) · Label: `wayfinder:research` · Status: **closed** · Assignee: **Mike**
Blocked by: —

## Question

Read Kick's public API docs (https://dev.kick.com/) and answer, with citations, the
questions the ACT step and the measure step hang on. Produce a markdown summary as a
linked asset.

The load-bearing one first:

1. **Does a message the app sends come back through the `chat.message.sent` webhook?**
   This decides whether the fired action enters the same stream we measure. If it does
   not echo, the backend has to inject it locally, and the verdict event needs a way to
   point at an action message that never appeared in the feed.

Then:

2. The exact request shape, auth, and required scope for sending a chat message.
3. Rate limits on sending — how many, over what window, and what the error looks like
   when exceeded. Relevant because the cooldown rule is 1 action / 3 min but a demo may
   fire faster.
4. Whether messages can be sent as a bot identity distinct from the broadcaster, and
   what that requires.
5. Whether Kick has any native poll or pinned-message primitive we'd be reinventing —
   if a native poll exists, the debate path may not need chat-parsed votes at all.
6. What `chat.message.sent` actually carries that we aren't reading yet (reply-to,
   message type, badge detail) — anything the detectors could use for free.

Question 5 is worth real attention: a native poll would change ticket 006 substantially.


## Resolution

Full findings: [assets/002-kick-chat-send.md](../assets/002-kick-chat-send.md). Source note —
`dev.kick.com` 403s non-browser clients; the live corpus is `docs.kick.com/llms-full.txt`,
which was read in full, so gaps below are genuine absences, not sampling.

1. **Echo-back: NOT DOCUMENTED.** Nothing states whether an API-sent message returns via
   `chat.message.sent`. No `is_self` / `via_api` flag either way. **Build for the no-echo
   case** — that design also survives if echo turns out to happen. The backend owns the
   action record, keyed by the `data.message_id` the send returns, and the contract
   carries a **nullable** `observed_in_feed` — the honest encoding of an open question.
   Two further reasons not to depend on echo: shadowbanned-phrase filtering can swallow
   chat webhooks channel-wide for ~20 min, and chat webhook delivery reportedly stalls
   intermittently.
2. **Send endpoint** is documented (Chat: post + delete only). `type: "bot"` is real and
   `broadcaster_user_id` is ignored in bot mode.
3. **Rate limits: refused, not missing.** A Kick maintainer explicitly declined to publish
   them. Only `429` is specified, generic body, no documented `Retry-After`. The
   "640 req/min" figure circulating online belongs to a different API — do not build
   against it.
4. **Bot identity: mechanism documented, flow is not.** How a bot account is created, and
   the claim that bot mode needs a token from *the broadcaster* rather than the bot
   account, appear only in community comments. Leads to verify, not facts — feeds
   [001](001-kick-write-scope.md).
5. **No native poll and no native pin.** Polls are an open feature request ("on our
   roadmap"). So chat-parsed voting is not a reinvention we could have avoided — it is the
   only option. And with no pin, **the fired prompt scrolls away**, which the contract and
   the poll card both have to absorb.
6. **Free signal we aren't reading.** `replies_to` carries a full nested parent message —
   a reply graph, and direct attribution when chat replies to *our* fired action.
   Also unused: `sender.user_id` (the safe key for unique-chatter counting — `username` is
   not), badge `count` (sub tenure, a real raid discriminator, currently collapsed to
   booleans), `identity.username_color`, and `payload.created_at` (Kick's send time; the
   gap against the delivery header *is* the webhook lag).
7. **`channel.followed` carries no timestamp at all**, unlike the subscription events.
   Follow timing comes from the delivery header, so a follow-rate detector measures
   *delivery* rate and must not use a tight window.

**Live bug found, outside this ticket's scope:** `ChatEventOut.from_envelope` reads
`e.get("name")` from `payload.emotes`, but documented entries carry only `emote_id` and
`positions`. Emote names are inline in `content` as `[emote:<id>:<NAME>]`. The emote list
is therefore always empty strings today.
