# Kick chat-send: echo-back, identity, rate limits

Asset for [ticket 002](../tickets/002-kick-chat-send-research.md) · researched 2026-07-25

**Source note.** `https://dev.kick.com/` returns HTTP 403 to non-browser clients. The live
docs are served at `https://docs.kick.com/`, which publishes a machine-readable full corpus
at <https://docs.kick.com/llms-full.txt> (index at <https://docs.kick.com/llms.txt>). Every
"documented" claim below is from that corpus or the rendered page it maps to. Claims marked
*community* come from the Kick-maintained issue tracker
<https://github.com/KickEngineering/KickDevDocs> and are **not** official documentation.

---

## Answers at a glance

| # | Question | Answer | Confidence |
|---|---|---|---|
| 1 | Does an app-sent message echo back via `chat.message.sent`? | **NOT DOCUMENTED — needs empirical test.** The docs never state whether API-sent messages are re-delivered as webhooks. | **unknown** |
| 2 | Send request shape / auth / scope | `POST https://api.kick.com/public/v1/chat`, OAuth 2.1 **UserAccessToken**, scope **`chat:write`**. Body: `content` (≤500 chars, req), `type` (`user`\|`bot`, req), `broadcaster_user_id` (int), `reply_to_message_id` (uuid). | documented |
| 3 | Rate limits on sending | **NOT DOCUMENTED, and deliberately so** — Kick staff: "we won't be exposing rate limits information at this moment." Only the `429 Too Many Requests` response code is specified; body shape is the generic `{data, message}`. | **unknown** (that limits exist is documented; the numbers are not) |
| 4 | Bot identity distinct from broadcaster? | Yes — `type: "bot"`. Requires a Bot created under the app owner's account, and a **user token from the broadcaster** whose chat you post into. `broadcaster_user_id` is ignored in bot mode. | documented (mechanism) + community (setup steps) |
| 5 | Native poll or native pinned message in the public API? | **No.** No poll endpoint, no pin endpoint, no poll/pin event. Polls are an open feature request; Kick staff say "on our roadmap". Pinning appears only as a read-only `pinned_time_seconds` field on `kicks.gifted`. | documented (by absence) + staff comment |
| 6 | What `chat.message.sent` carries that we don't read | `replies_to` (whole parent message), `sender.user_id`, `sender.is_anonymous`, `sender.is_verified`, `sender.channel_slug`, `sender.profile_picture`, `identity.username_color`, badge `count` (sub months / gifts), `emotes[].positions`, `payload.created_at`, `broadcaster.*`. **No message-`type` field exists on the webhook.** | documented |
| 7 | Other events useful for raid-wave detection | `channel.followed` is the strong signal (fires per follow). `channel.subscription.new` / `.gifts` / `.renewal` and `kicks.gifted` are secondary. **`channel.followed` carries no timestamp of its own** — timing must come from the `Kick-Event-Message-Timestamp` header. | documented |

---

## 1. LOAD-BEARING: does an app-sent message come back through `chat.message.sent`?

### NOT DOCUMENTED — needs empirical test.

I read the complete published corpus. Neither the Chat API page
(<https://docs.kick.com/apis/chat>), the Events introduction
(<https://docs.kick.com/events/introduction>), nor the Webhook Payloads page
(<https://docs.kick.com/events/event-types>) says anything about whether a message posted
via `POST /public/v1/chat` is subsequently delivered to the app's own webhook. The
`chat.message.sent` description is only "Fired when a message has been sent in a stream's
chat" (<https://docs.kick.com/events/event-types>) — which is *suggestive* of echo but is
not a statement about API-originated messages, and there is no documented loop-suppression,
no `is_self` / `via_api` flag on the payload, and no "your own messages are excluded" note
anywhere.

Two further reasons not to assume echo even if the mechanism exists:

- **Shadowbanned-phrase filtering swallows webhooks.** Reported behaviour: certain
  shadow-banned words stop a message being delivered to webhooks, and can stop *all* chat
  message events in that channel for ~20 minutes
  (<https://github.com/KickEngineering/KickDevDocs/issues/171>). LLM-generated action copy
  could trip this.
- **Chat webhook delivery is reported as intermittent/stalling** in production
  (<https://github.com/KickEngineering/KickDevDocs/issues/300>,
  <https://github.com/KickEngineering/KickDevDocs/issues/233>). Echo, even if it happens,
  is not a reliable clock.

### Smallest test that answers it

1. Ensure the app has an active `chat.message.sent` subscription for the broadcaster
   (existing `create_subscriptions` in `/Users/mikhailolianenko/kick-insights/server/src/easy_kick/kick_api.py`).
2. `POST /public/v1/chat` with `type: "user"`, a nonce string (e.g. `kickinsights-probe-<uuid4>`),
   and record the returned `data.message_id`.
3. Watch the webhook route for 30 s. Assert on **two** things, not one:
   - did any `chat.message.sent` arrive whose `payload.message_id` equals the returned
     `data.message_id`? (identity of the id spaces is itself unverified)
   - did any arrive whose `payload.content` contains the nonce?
4. Repeat with `type: "bot"`. Bot-sent messages may be treated differently from user-sent
   ones, so **both branches must be probed separately.**

Total: ~20 lines against the existing client. This is the single highest-value hour of
pre-hackathon work, because it decides whether the ACT step lands in the measured stream
or has to be injected.

### What the contract must do until it is answered

Design for the **worst case (no echo)**, because that design also works if echo happens:
the backend owns the canonical action record and injects it into the ring buffer itself,
keyed by the `data.message_id` the send endpoint returns. If echo does occur, the webhook
arrival is deduped against that key rather than being the thing that creates the record.
That is one dedupe rule, not two code paths — and it is exactly what the sim branch already
has to do.

---

## 2. Request shape, auth, scope

Source: <https://docs.kick.com/apis/chat> (OpenAPI fragment embedded in
<https://docs.kick.com/llms-full.txt>).

```
POST https://api.kick.com/public/v1/chat
Authorization: Bearer <UserAccessToken>
Content-Type: application/json
```

Security scheme: `UserAccessToken` (OAuth 2.1 authorization-code + PKCE), scope
**`chat:write`**. The OpenAPI block declares `"security":[{"UserAccessToken":["chat:write"]}]`
for this path — note it is a *UserAccessToken only* endpoint; an AppAccessToken is not
listed as accepted here (unlike, say, the events-subscription endpoints, which list both).

Scope definition: `chat:write` — "Send chat messages and allow chat bots to post in your
chat" (<https://docs.kick.com/getting-started/scopes>).

Auth server: `https://id.kick.com/oauth/authorize` / `https://id.kick.com/oauth/token`
(<https://docs.kick.com/getting-started/generating-tokens-oauth2-flow>) — matches
`auth_base` already in `/Users/mikhailolianenko/kick-insights/server/src/easy_kick/config.py`.

### Body — `endpoints.PostChatParams`

| Field | Type | Required | Notes |
|---|---|---|---|
| `content` | string, `maxLength: 500` | **yes** | the message text |
| `type` | enum `"user"` \| `"bot"` | **yes** | see Q4 |
| `broadcaster_user_id` | integer | required for `type: "user"`; **ignored** for `type: "bot"` | |
| `reply_to_message_id` | string, uuid | no | threads the message under a parent |

### Response — `endpoints.ChatResp`

`200 OK`:
```json
{ "data": { "is_sent": true, "message_id": "<uuid>" }, "message": "..." }
```

Documented status codes: `200, 400, 401, 403, 404, 429, 500`. All non-500 error bodies use
the generic `httpx.Response` schema `{ "data": <any>, "message": string }`; `500` uses
`endpoints.ErrorResponse`, which has the identical shape. **There is no documented
machine-readable error code enum** — error discrimination has to be on HTTP status alone.

Also on the same page: `DELETE /public/v1/chat/{message_id}`, scope
`moderation:chat_message:manage` (changelog 02/12/2025,
<https://docs.kick.com/changelog>). Relevant only if a fired action ever needs retracting.

### Known operational hazard

`POST /public/v1/chat` has a history of intermittent `403 "Request blocked by security
policy"` from Cloudflare — see
<https://github.com/KickEngineering/KickDevDocs/issues/281> and
<https://github.com/KickEngineering/KickDevDocs/issues/216>. Setting a normal `User-Agent`
is the commonly-cited mitigation. Budget a retry and a visible failure state for ACT.

---

## 3. Rate limits on sending

### NOT DOCUMENTED — and Kick has explicitly declined to document it.

- The docs corpus contains **no rate-limit page and no rate-limit section**. The only
  rate-limit artefact anywhere is the `429 Too Many Requests` response listed on the chat
  endpoint (<https://docs.kick.com/apis/chat>), with the generic `{data, message}` body.
- Asked directly to publish limits, a Kick maintainer replied: "Sorry we won't be exposing
  rate limits information at this moment"
  (<https://github.com/KickEngineering/KickDevDocs/issues/311>, closed 2025-12-16).
- **No documented `X-RateLimit-*` / `Retry-After` headers.** Whether any are returned is
  unverified.

Numbers circulating on third-party sites (e.g. "640 req/min") belong to *other* APIs, not
Kick's public API. Do not build against them.

### What is documented adjacent to this

Subscription limits, which are a different thing but worth knowing:
10,000 subscriptions per event type per app; **1,000 for `chat.message.sent` on unverified
apps** (<https://docs.kick.com/events/subscribe-to-events>). Verification lifts it to
10,000 and is requested by emailing `developers@kick.com`
(<https://docs.kick.com/apis/faqs>).

### Smallest test

Fire N sends in a tight loop against a private test channel, increasing N, and record
(a) at what count the first `429` appears, (b) the full response headers on that `429`
(look for `Retry-After`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`), (c) the `message`
string in the body, (d) how long until sends succeed again. Do this **once**, on a throwaway
channel, well before demo day — repeatedly probing a limit you can't see is a good way to
get an app flagged.

### Contract implication

The 1-action / 3-min cooldown is far below any plausible platform limit, so the *rule* is
safe. The exposure is a demo operator mashing the button, or a replay/experiment surface
firing fast. Rate-limit handling therefore belongs in the backend send path, not the UI:
on `429`, the action must resolve to a terminal failed state that the verdict card can
render honestly ("not sent"), never a silent drop.

---

## 4. Bot identity distinct from the broadcaster

**Yes — this is the documented purpose of the `type` field.** From the endpoint description
(<https://docs.kick.com/apis/chat>):

> "Post a chat message to a channel as a user or a bot. When sending as a user, the
> `broadcaster_user_id` is required. Whereas when sending as a bot, the
> `broadcaster_user_id` is not required and is ignored. As a bot, the message will always
> be sent to the channel attached to your token."

So the mechanism is documented; the **setup** is not. What the docs do say:

- The `chat:write` scope description explicitly covers bots: "Send chat messages and allow
  chat bots to post in your chat" (<https://docs.kick.com/getting-started/scopes>).
- App verification grants a "Verified badge on **bot account**", requested via
  `developers@kick.com`; the request form asks "Whether the bot also requires verification"
  (<https://docs.kick.com/apis/faqs>). This confirms bot accounts are a first-class concept
  but describes no creation flow.

**NOT DOCUMENTED — the bot creation and authorization flow.** There is no docs page
covering how a bot account comes into existence, what badge it renders with, or why
`type: "bot"` returns 500 for a misconfigured app.

*Community* answers filling that gap, from
<https://github.com/KickEngineering/KickDevDocs/issues/343> (open feature request asking
Kick to document exactly this) — treat as leads to verify, not fact:

1. Create the bot under the account that **owns the app**: Settings → Developer → your
   application → Edit → "create a BOT for this account". Missing this step is the reported
   cause of the `500` on `type: "bot"`.
2. The token used for `type: "bot"` must be a **user access token from the broadcaster
   whose chat you are posting into** — not from the bot account. The broadcaster runs the
   OAuth flow and grants `chat:write`; your app then posts into their channel as the bot,
   with the bot badge. This mirrors Twitch's model.
3. `type: "user"` with the bot account's own token also works and can target any channel,
   but renders as an ordinary user with no bot badge.

### Contract implication

The identity the action is sent under is a **property of the action, decided at send time**,
and it changes how the message looks in chat and possibly whether it echoes. Put
`sent_as: "user" | "bot" | "sim"` on the action/verdict event from hour zero. It costs one
enum field now and is unrecoverable later if the bot path turns out to be the one that
works on the day.

---

## 5. Native poll or native pinned message? — **No.**

This is a clean answer and it matters for ticket 006.

**Every endpoint in the public API** (from <https://docs.kick.com/llms.txt> and the section
headings of <https://docs.kick.com/llms-full.txt>): Categories, Users, Channels, Channel
Rewards, **Chat (Post Chat Message, Delete Chat Message)**, Moderation (ban/unban),
Livestreams, Public Key, KICKs leaderboard, Events subscriptions, Drops. **There is no
poll endpoint and no pin endpoint.** No `poll.*` or `pin.*` event exists in the ten-event
webhook table either (<https://docs.kick.com/events/event-types>).

Corroborating, on the record:

- **Polls are an unbuilt feature request.** <https://github.com/KickEngineering/KickDevDocs/issues/151>
  ("Feature Request: Creating polls", open since 2025-04-22). Kick staff reply:
  *"This feature is on our roadmap, and we'll share updates here as we make progress."*
  The requester notes the only current route is logging in as a channel moderator and using
  the internal v2 API — i.e. not something to build a hackathon demo on.
- **Pinning is likewise absent.** <https://github.com/KickEngineering/KickDevDocs/issues/345>
  enumerates the chat `/commands` with no public-API analog, including `/poll`,
  `/polldelete` and `/prediction`. Open, no staff response.
- The only occurrence of pinning anywhere in the corpus is the read-only
  `gift.pinned_time_seconds` field on the `kicks.gifted` webhook payload
  (<https://docs.kick.com/events/event-types>) — a value Kick pins a *gift* for. It is not
  a pin primitive we can invoke.

### Consequence for ticket 006

Chat-parsed vote capture is not a reinvention we could avoid — it is **the only option**.
There is no native poll to defer to, and no native pin to keep the prompt visible, so the
vote prompt is an ordinary chat message that scrolls away like any other. Two things follow
that the design has to absorb:

- The prompt's visibility decays. Vote counting has to tolerate a long, thin tail and
  probably a re-prompt, rather than assuming a stable on-screen poll.
- We own the whole vote lifecycle — open, tally, close, announce. That is more surface than
  a native poll would need, but it is also fully under our control and fully legible in the
  demo, which is worth something against the 25% creativity / 25% product weighting.

---

## 6. What `chat.message.sent` carries that `ChatEventOut.from_envelope` isn't reading

Full documented payload at <https://docs.kick.com/events/event-types>. Current reader:
`/Users/mikhailolianenko/kick-insights/server/src/easy_kick/models.py`.

Read today: `message_id`, `content`, `sender.username`, `sender.identity.badges[].type`,
`emotes[].name`, plus the envelope timestamp.

### On the table and unused

| Field | Shape | Why a detector wants it |
|---|---|---|
| **`replies_to`** | full nested message: `{message_id, content, sender:{...}}` — added 20/08/2025 (<https://docs.kick.com/changelog>) | **The single biggest miss.** Gives a real reply graph for free: conversational threads, whether chat is replying *to our fired action message* (direct attribution for the verdict!), and reply density as a debate signal. Note `replies_to.sender.identity` is explicitly `null` — parent-sender badges are not provided. |
| **`sender.user_id`** | int | Stable identity. `username` is not a safe key. Unique-user counts for raid-wave detection, and per-user dedupe for vote capture, both need this. |
| **`sender.is_anonymous`** | bool | Anonymous senders have null-ish identity; a raid of anonymous accounts looks different from a raid of real ones. |
| **`sender.is_verified`** | bool | Cheap trust/weight signal. |
| **`sender.channel_slug`** | string | Sender's own channel — a burst sharing one origin slug is a genuine raid tell. |
| **`sender.profile_picture`** | url | Avatars in the chat feed. Free UX. |
| **`identity.username_color`** | hex, e.g. `#FF5733` | Kick's own per-user colour. Rendering it is free authenticity; picking our own hash colour is strictly worse. |
| **badge `count`** | int on `subscriber` (months) and `sub_gifter` (gifts) | Current code collapses badges to booleans and throws the counts away. Sub *tenure* separates regulars from newcomers — directly a raid-wave discriminator. |
| **badge `text`** | display string, e.g. `"Sub Gifter"` | Render-ready label. |
| **`emotes[].positions`** | `[{s, e}]` char spans | Needed to render emotes inline rather than as a name list. Note the payload gives `emote_id`, **not** a `name` — the current code reads `e.get("name")`, which is **not a documented field** and will silently yield `""`. Emote names appear only inside `content` as `[emote:<id>:<NAME>]`. **This looks like a live bug.** |
| **`created_at`** | RFC3339, added 22/07/2025 | Kick's own send time, distinct from `Kick-Event-Message-Timestamp` (delivery time). The gap between the two *is* the webhook delivery lag — worth measuring given the reported delays, and the honest field to timestamp the measurement window against. |
| **`broadcaster.*`** | user object | Multi-channel routing if it ever matters. |

### Explicitly NOT present

- **There is no message `type` / `message_type` field on the webhook payload.** The
  `type: "user" | "bot"` enum exists *only on the send request body*
  (<https://docs.kick.com/apis/chat>), and nothing in the documented webhook payload
  reflects it back. **NOT DOCUMENTED — needs empirical test:** whether a bot-sent message,
  if it echoes at all, is distinguishable from a user message in the payload. Fold this
  into the Q1 probe: diff the received payload for a `type:"bot"` send against a
  `type:"user"` send.
- No `is_follower` — an open request (<https://github.com/KickEngineering/KickDevDocs/issues/84>).
- No message-deleted / moderation-of-message event.

---

## 7. Other events usable for raid-wave detection

All shapes from <https://docs.kick.com/events/event-types>. Subscribed set is `KNOWN_EVENTS`
in `models.py` and already covers all ten documented events, so **no new subscriptions are
needed** — this is signal already arriving and being dropped.

**`channel.followed` — the primary raid signal.** Fires per follow. Payload is
`{broadcaster:{...}, follower:{...}}` and nothing else. A raid is a burst of first-time
arrivals, and a follow burst is the most direct observable of that.

> **Timing gotcha, documented by absence:** `channel.followed` has **no `created_at` and no
> timestamp of any kind in its body** — unlike the subscription events, which all carry
> `created_at`. Follow timing must come from the `Kick-Event-Message-Timestamp` header
> (<https://docs.kick.com/events/webhook-security>), which is *delivery* time, not event
> time. The existing webhook route already populates `EventEnvelope.timestamp` from that
> header (`routes/webhook.py`), so this works — but a follow-rate detector is measuring
> delivery rate, and inherits any webhook delay. Given the reported intermittency
> (<https://github.com/KickEngineering/KickDevDocs/issues/300>), a follow-burst detector
> should not use a window tighter than a few tens of seconds.

**`channel.subscription.new`** — `{broadcaster, subscriber, duration, created_at, expires_at}`.
Carries `created_at`. Lower volume, higher intent; a good confirming signal, too sparse to
lead on.

**`channel.subscription.gifts`** — `{broadcaster, gifter, giftees[], created_at, expires_at}`.
`giftees` is an **array**, so one event can represent many new subscribers at once — the
count of `giftees` is itself a burst magnitude. `gifter` fields are all `null` when
`is_anonymous` is true.

**`channel.subscription.renewal`** — `{..., duration, created_at, expires_at}`. Renewals are
*existing* community, so this is a useful **negative** control: renewals up but follows flat
is a hype moment, not a raid. Caveat: reportedly not fired when the resub includes a message
(<https://github.com/KickEngineering/KickDevDocs/issues/189>).

**`kicks.gifted`** — `{broadcaster, sender, gift:{amount, name, type, tier, message,
pinned_time_seconds}, created_at}`. Monetary hype spike. Per the map, `hype_spike` is a
timeline marker only, which is where this belongs.

**`livestream.status.updated`** — `{broadcaster, is_live, title, started_at, ended_at}`.
Not a raid signal, but the correct gate for the whole loop: don't detect, suggest, or
measure while `is_live` is false.

**`moderation.banned`** — `{broadcaster, moderator, banned_user, metadata:{reason,
created_at, expires_at}}`. A cluster of bans right after a user burst distinguishes a
*hostile* raid from a friendly one — arguably a different suggestion.

### Composite worth having

`raid_wave` is most honestly detected as **unique new `sender.user_id`s per window** (Q6)
**corroborated by follow-event rate** (Q7), not by message volume — message volume alone
can't tell a raid from the existing chat getting loud, and that distinction is exactly what
separates `raid_wave` from `hype_spike`.

---

## What this forces on the event contract

Implications for the `state` / `suggestion` / `verdict` events. Each is a consequence of
something above, not a preference.

### 1. The action's presence in the measured stream is not guaranteed — so the contract must carry the action, not point at it

Because Q1 is unknown and echo may be absent, delayed, or filtered by the shadowban
behaviour, **the verdict event cannot reference the fired action by "the chat message with
this id in the feed."** The action must be a first-class object the backend emits, with the
Kick `message_id` as an *attribute* rather than a foreign key into the chat feed:

```
action: {
  action_id,             // ours, always present, generated before the send
  kick_message_id,       // from data.message_id; null on failure or in sim
  sent_as,               // "user" | "bot" | "sim"      (Q4)
  status,                // "pending" | "sent" | "failed" | "rate_limited"  (Q3)
  content,               // what we actually sent
  sent_at,               // our clock
  observed_in_feed       // bool | null — null means "we don't know yet"  (Q1)
}
```

`observed_in_feed` being explicitly *nullable* is the honest encoding of an open empirical
question. If the probe shows echo, it becomes a real boolean and the timeline can render
the action inline in the feed. If not, it stays `false` and the frontend renders the action
as an overlaid marker on the timeline instead. **Same schema either way** — which is the
point of deciding this now rather than on Saturday.

### 2. `status` must be able to say "not sent"

`429` (Q3) and intermittent Cloudflare `403` (Q2) are both real. A fired action that never
reached chat must still produce a verdict-shaped event, with `status: "failed"` and no
lift computed. A verdict card that reports a measured lift for a message that was never
delivered is the worst possible failure for a product whose whole claim is an honest loop.

### 3. Timestamps need a named source

Two clocks exist per chat event: `payload.created_at` (Kick's send time) and
`Kick-Event-Message-Timestamp` (delivery). `channel.followed` has only the second (Q7).
The measurement window on the verdict event should state which clock it used, and the
detectors should agree. Suggest carrying `ts` plus `ts_source: "created_at" | "delivery"`
on normalized events — this is one field, and without it the 2-min/2-min window silently
means different things for chat versus follow events.

### 4. `state` events need the raid-wave inputs the current reader discards

`raid_wave` detection needs `sender.user_id` (unique-user counting) and follow-event rate.
Neither is currently surfaced by `ChatEventOut`. The normalized chat event should gain
`user_id`, `is_anonymous`, `sub_months` (from badge `count`), and `replies_to_id`; the
event stream needs a normalized non-chat event type so `channel.followed` reaches the
detectors at all. This is the adapter boundary the map already calls for, and these are
the fields it must expose.

### 5. The debate path owns the entire poll lifecycle

With no native poll (Q5), `suggestion` events for the `debate` state must carry the vote
schema explicitly — the option set, the token users type, and the vote window — because
nothing on Kick's side holds that state for us. And since there is no pin, the prompt
scrolls away: the contract should allow a suggestion to be *re-fired* within one vote
window without that counting as a new bandit trial. Otherwise the cooldown rule and the
practical need to re-prompt are in direct conflict.

### 6. `sent_as` is cheap now and unrecoverable later

Whether Saturday's demo posts as the broadcaster or as a bot depends on a setup flow that
isn't documented (Q4) and may not be working by then. Carrying the enum from hour zero
means the fallback is a config change, not a schema change.

---

## Open empirical questions, ranked

| Q | Question | Test | Cost |
|---|---|---|---|
| 1 | Does an API-sent message echo via `chat.message.sent`? | Nonce probe, both `type` values, watch webhook 30 s | ~20 lines, 1 hour |
| 6 | Does an echoed bot message look different from a user message? | Diff payloads from the same probe | free, same test |
| 3 | Actual send rate limit + `429` body/headers | Loop until `429` on a throwaway channel, dump headers | 30 min, do once |
| 4 | Does `type: "bot"` work for our app at all? | One send; a `500` means the bot isn't created under the app owner | 10 min |
| 2 | Does the Cloudflare `403` hit us? | Send with and without a browser-ish `User-Agent` | 10 min |

Q1, Q6 and Q4 are all answered by a single ~30-line probe script. **That script is ticket
002's real deliverable** — everything documented is above, and what's left cannot be read,
only measured.
