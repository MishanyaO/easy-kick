"""Participation rewards: who took part in an intervention, what that earns them, and the
lines the bot posts to say so.

The point is the *other* viewers. A poll that closes silently teaches nobody that answering
is worth doing; a line naming the people who answered is the cheapest advertisement chat has
for taking part next time. So these lines go into real chat, not just onto the dashboard.

Two rules keep that from becoming spam. One award per viewer per window, so participation is
binary rather than a volume game — otherwise an emote rally rewards whoever spams hardest,
which is both farmable and a direct inflation of the participation metric this whole app is
judged on. And a hard ceiling of two bot lines per window: the award, and the tier-ups.

Deliberately NOT in here: any call into `RewardBook`. An award is a real message and real
messages move chat, but treating one as a fired intervention would open a 120s contamination
shadow behind every rewarded window and push most of the ledger to "Can't tell". The
over-crediting that leaves behind is small, roughly equal across arms, and therefore mostly
cancels in the *comparison* between tactics — which is the only thing the bandit reads.
"""

from dataclasses import dataclass, field

from .engagement import BOT_NAME
from .models import Arm, EventType
from .store import EventStore

# What one window's participation is worth, by arm. Priced by effort: typing an emote is
# not the same act as reading a question and picking a side. Arms absent from this table
# award nothing at all, and that is the whole configuration —
#   `prediction` runs through Kick's own prediction widget, so who backed which side never
#     reaches chat and any award we posted would be congratulating the wrong people;
#   `chat_digest` is never posted to chat, so nobody could have participated in it;
#   `nothing` is the control, and a bot line inside one is noise in the yardstick.
XP_PER_ARM: dict[Arm, int] = {
    Arm.EMOTE_RALLY: 5,
    Arm.CHAT_POLL: 10,
    Arm.QUIZ: 15,
}

# Named XP ranges, low → high. Tiers are not a second currency: a badge is just what a total
# is called, so there is one number to reason about and one to explain.
#
# Thresholds are measured, not guessed. A two-hour story pays out ~22 windows to ~85 distinct
# chatters, and the totals come out compressed: median 10–20 XP, p95 around 40, top 45–60.
# The first draft of this table (30/80/160) put Veteran and Legend past the end of every
# session — a milestone nobody ever crosses is the same as not shipping the feature.
#
# These floors were checked against seeds 7, 3 and 11 and give a real pyramid in each
# (roughly 30–45 Newcomers, 25–50 Regulars, 10–15 Veterans, 1–6 Legends). Legend stays rare
# without being unreachable, which is the only property here worth protecting: retune these
# if the arc, the XP rates, or the run length change.
TIERS: tuple[tuple[int, str, str], ...] = (
    (0, "Newcomer", "🌱"),
    (15, "Regular", "⚡"),
    (30, "Veteran", "🔥"),
    (45, "Legend", "👑"),
)

# The client tells our award lines apart from our intervention lines by their leading
# character, because on live Kick nothing else survives: we post through `chat:write` and the
# message comes back in through the webhook as an ordinary chat message with no room for
# metadata of our own. The sigil that makes the line readable in real chat is therefore also
# the marker the dashboard keys off — and it is only ever trusted on a message whose sender
# is the bot, so a viewer opening with the same emoji cannot forge one.
# Loot, not a trophy: the line is "here is your share", not "you came first". Unicode has no
# treasure-chest glyph, so this is the nearest one that reads as a haul rather than a prize.
# Changing it is a one-line change here and in `AWARD_SIGILS` in `types.ts` — they are the
# two ends of the same wire and must not drift.
AWARD_SIGIL = "💰"
PROMOTION_SIGIL = "🎉"

# How many people a single line names before it collapses to "+N more". Three is about where
# a chat message stops being a greeting and starts being a list.
NAMED_LIMIT = 3

# Rows the standings snapshot carries. Comfortably more than a leaderboard shows, so the
# table can sort and filter client-side without another round trip.
STANDINGS_LIMIT = 20

# Unicode blocks that mean "this message is an emoji", for live chat where viewers type 🔥
# rather than Kick's `[emote:…]` markup. Coarse on purpose — a false positive here awards
# 5 XP to someone who was participating in spirit anyway.
_EMOJI_RANGES = (
    (0x1F300, 0x1FAFF),  # pictographs, emoticons, symbols, supplemental
    (0x2600, 0x27BF),  # misc symbols and dingbats
    (0x1F000, 0x1F2FF),  # mahjong through enclosed alphanumerics
    (0x2B00, 0x2BFF),  # arrows and stars
)


@dataclass(frozen=True)
class Participant:
    """One viewer who took part, keyed the way ballots are keyed."""

    key: str  # `id:<user_id>` where Kick sends one, else `name:<username>`
    name: str  # display text, for the chat line


@dataclass(frozen=True)
class Promotion:
    user: str
    tier: str
    emoji: str
    xp: int


@dataclass(frozen=True)
class Awarded:
    """One viewer's share of one window, with where it left their session total.

    The total travels with the award rather than being looked up later: the Rewards tab
    shows a column per intervention, and a column that had to join against a top-20
    leaderboard would print blanks for everyone below it.
    """

    user: str
    xp: int  # their session total *after* this award, not the amount it paid
    # The tier that total puts them in, resolved here rather than client-side: the
    # thresholds are tuned against real runs and having a second copy of them in the
    # dashboard is a drift waiting to happen.
    tier: str
    emoji: str


@dataclass(frozen=True)
class Grant:
    """What one closed window awarded."""

    arm: Arm
    xp: int
    awarded: list[Awarded]
    promotions: list[Promotion]


@dataclass
class Standing:
    name: str
    xp: int = 0
    awards: int = 0

    @property
    def tier(self) -> tuple[str, str]:
        return tier_for(self.xp)


@dataclass
class AwardBook:
    """Session-scoped XP, keyed by viewer identity.

    Session-scoped on purpose, not as a shortcut. The story replays a seed exactly, and that
    determinism is most of what makes it worth demonstrating; XP carried over from a previous
    run would make the second replay of a seed post different lines than the first, and
    quietly retire the one property anybody checks.
    """

    _standings: dict[str, Standing] = field(default_factory=dict)

    def grant(self, arm: Arm, participants: list[Participant], xp: int) -> Grant | None:
        """Credit everyone once. Returns None when nobody took part.

        One entry per viewer is guaranteed by `participants` already deduping on identity —
        the cap is a property of the input, so there is no counting to get wrong here.
        """
        if not participants or xp <= 0:
            return None
        promotions: list[Promotion] = []
        awarded: list[Awarded] = []
        for person in participants:
            standing = self._standings.setdefault(person.key, Standing(person.name))
            standing.name = person.name  # a display name can change; the key does not
            before, _ = tier_for(standing.xp)
            standing.xp += xp
            standing.awards += 1
            after, emoji = tier_for(standing.xp)
            awarded.append(Awarded(person.name, standing.xp, after, emoji))
            if after != before:
                promotions.append(Promotion(person.name, after, emoji, standing.xp))
        return Grant(arm=arm, xp=xp, awarded=awarded, promotions=promotions)

    def standings(self, limit: int = STANDINGS_LIMIT) -> list[dict]:
        """Top viewers by XP, newest totals first. Snapshot-shaped, like the bandit table:
        a tab that opens an hour in, or reconnects after the frame history has rolled over,
        gets the whole board from the next frame rather than a partial sum of deltas."""
        ranked = sorted(
            self._standings.values(), key=lambda s: (-s.xp, s.name.lower())
        )[:limit]
        return [
            {
                "user": s.name,
                "xp": s.xp,
                "awards": s.awards,
                "tier": s.tier[0],
                "emoji": s.tier[1],
            }
            for s in ranked
        ]

    @property
    def participants(self) -> int:
        return len(self._standings)


def tier_for(xp: int) -> tuple[str, str]:
    """The name and emoji for an XP total."""
    name, emoji = TIERS[0][1], TIERS[0][2]
    for floor, tier_name, tier_emoji in TIERS:
        if xp >= floor:
            name, emoji = tier_name, tier_emoji
    return name, emoji


def participants(
    store: EventStore,
    arm: Arm,
    options: list[str] | tuple[str, ...],
    since: float,
    until: float,
) -> list[Participant]:
    """Who took part in this window, earliest first.

    Detection is per-arm because "participating" means a different thing per arm, and a
    single arm-agnostic rule would be wrong in both directions: counting everyone who talked
    hands XP to viewers mid-argument about the last fight who never saw the poll, and
    counting only newly-activated viewers permanently excludes the regular who answers every
    single time.

    Earliest first mirrors `ballots`, where the first vote is the one that counts — so the
    people a line names are the people who were quickest, which is a rule a viewer can infer
    from watching, and it is deterministic, so a story replays identically.
    """
    if arm in (Arm.CHAT_POLL, Arm.QUIZ):
        if not options:
            return []
        # Deferred: the controller imports this module, so a top-level import here would
        # be a cycle. Reusing its matcher rather than copying it is the point — a poll that
        # counted `1)` as a ballot but awarded nothing for it would be its own bug report.
        from .controller import _normalise, _vote_for

        lookup = {_normalise(option): option for option in options}

        def took_part(content: str) -> bool:
            return _vote_for(content, lookup) is not None

    elif arm is Arm.EMOTE_RALLY:
        took_part = has_emote
    else:
        return []

    return _scan(store, since, until, took_part)


def has_emote(content: str) -> bool:
    """Kick inlines emotes as `[emote:<id>:<NAME>]`; viewers on live chat also just type 🔥."""
    if "[emote:" in content:
        return True
    return any(
        any(low <= ord(ch) <= high for low, high in _EMOJI_RANGES) for ch in content
    )


def _scan(
    store: EventStore, since: float, until: float, took_part
) -> list[Participant]:
    """Chat in [since, until], oldest first, one entry per viewer at their first qualifying
    message. The store iterates newest-first, so the window is collected and then reversed —
    which is also what makes "first to take part" the order that comes out."""
    window = []
    for ev in store.iter_recent():
        ts = ev.epoch()
        if ts is not None and ts < since:
            break
        if ts is not None and ts > until:
            continue
        if ev.type != EventType.CHAT_MESSAGE_SENT:
            continue
        window.append(ev)

    seen: dict[str, Participant] = {}
    for ev in reversed(window):
        sender = ev.payload.get("sender") or {}
        name = sender.get("username")
        # Our own prompt sits inside this window, and the rally arm's own line carries an
        # emoji — awarding it would have the bot topping its own leaderboard.
        if not name or name == BOT_NAME:
            continue
        if not took_part(ev.payload.get("content") or ""):
            continue
        user_id = sender.get("user_id")
        key = f"id:{user_id}" if user_id is not None else f"name:{name}"
        seen.setdefault(key, Participant(key=key, name=name))
    return list(seen.values())


def award_line(grant: Grant, xp: int) -> str:
    """The one line chat sees when a window closes.

    Below `NAMED_LIMIT` nobody is hidden behind "+N more": a roll-call of one person is a
    worse message than naming them, and the lull — where a poll gets two answers — is exactly
    where the encouragement is supposed to land hardest.
    """
    names = [f"@{p.user}" for p in grant.awarded]
    if len(names) == 1:
        return f"{AWARD_SIGIL} {names[0]} picked up +{xp} XP for joining in — nice one!"
    if len(names) <= NAMED_LIMIT:
        return f"{AWARD_SIGIL} +{xp} XP each to {_join(names)} — thanks for playing!"
    shown = names[:NAMED_LIMIT]
    rest = len(names) - NAMED_LIMIT
    return (
        f"{AWARD_SIGIL} +{xp} XP each to {', '.join(shown)} "
        f"and {rest} more — chat's on it!"
    )


def promotion_line(promotions: list[Promotion]) -> str | None:
    """The rarer, better message. Batched into one line so a window can never post more than
    two — the ceiling that keeps this inside anyone's chat rate limit."""
    if not promotions:
        return None
    if len(promotions) == 1:
        p = promotions[0]
        return f"{PROMOTION_SIGIL} @{p.user} is now {p.emoji} {p.tier} — {p.xp} XP!"
    shown = [f"@{p.user} → {p.emoji} {p.tier}" for p in promotions[:NAMED_LIMIT]]
    rest = len(promotions) - NAMED_LIMIT
    tail = f" and {rest} more" if rest > 0 else ""
    return f"{PROMOTION_SIGIL} levelling up: {' · '.join(shown)}{tail}!"


def _join(names: list[str]) -> str:
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])} and {names[-1]}"
