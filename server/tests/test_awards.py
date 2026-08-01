"""Participation rewards: who earns them, what they earn, and what the bot says about it.

The rules worth pinning here are the ones that stop this becoming spam or a lie: one award
per viewer per window, a hard two-line ceiling, and arms that award nothing awarding nothing.
"""

import uuid

import pytest

from easy_kick.awards import (
    AWARD_SIGIL,
    PROMOTION_SIGIL,
    TIERS,
    XP_PER_ARM,
    AwardBook,
    Participant,
    award_line,
    has_emote,
    participants,
    promotion_line,
    tier_for,
)
from easy_kick.engagement import BOT_NAME
from easy_kick.models import Arm, EventEnvelope, EventType
from easy_kick.store import EventStore

EPOCH = 1_750_000_000.0


def chat(store: EventStore, at: float, who: str, text: str, user_id: str | None = None):
    store.add(
        EventEnvelope(
            type=EventType.CHAT_MESSAGE_SENT,
            version="1",
            message_id=uuid.uuid4().hex,
            timestamp=_iso(at),
            payload={
                "sender": {"username": who, "user_id": user_id},
                "content": text,
            },
        )
    )


def _iso(moment: float) -> str:
    from datetime import datetime, timezone

    return (
        datetime.fromtimestamp(moment, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


# --- who took part -----------------------------------------------------------------


def test_poll_participants_are_the_people_who_actually_voted():
    store = EventStore(maxlen=100)
    chat(store, EPOCH + 1, "alice", "yes")
    chat(store, EPOCH + 2, "bystander", "what happened to the stream")
    chat(store, EPOCH + 3, "bob", "no thanks")

    people = participants(store, Arm.CHAT_POLL, ["yes", "no"], EPOCH, EPOCH + 60)

    assert [p.name for p in people] == ["alice", "bob"]


def test_participants_come_out_earliest_first_so_a_replay_names_the_same_people():
    store = EventStore(maxlen=100)
    for i, who in enumerate(["carol", "alice", "bob"]):
        chat(store, EPOCH + 1 + i, who, "yes")

    people = participants(store, Arm.CHAT_POLL, ["yes", "no"], EPOCH, EPOCH + 60)

    assert [p.name for p in people] == ["carol", "alice", "bob"]


def test_a_viewer_who_votes_five_times_is_still_one_participant():
    store = EventStore(maxlen=100)
    for i in range(5):
        chat(store, EPOCH + 1 + i, "spammer", "yes")

    people = participants(store, Arm.CHAT_POLL, ["yes", "no"], EPOCH, EPOCH + 60)

    assert len(people) == 1


def test_the_bots_own_prompt_never_earns_the_bot_anything():
    store = EventStore(maxlen=100)
    chat(store, EPOCH + 1, BOT_NAME, "drop a 🔥 if you saw that")
    chat(store, EPOCH + 2, "alice", "🔥")

    people = participants(store, Arm.EMOTE_RALLY, [], EPOCH, EPOCH + 60)

    assert [p.name for p in people] == ["alice"]


def test_a_rally_counts_kick_emote_markup_and_typed_emoji_alike():
    store = EventStore(maxlen=100)
    chat(store, EPOCH + 1, "alice", "[emote:1730756:emojiCheerful]")
    chat(store, EPOCH + 2, "bob", "🔥🔥")
    chat(store, EPOCH + 3, "carol", "what are we doing")

    people = participants(store, Arm.EMOTE_RALLY, [], EPOCH, EPOCH + 60)

    assert [p.name for p in people] == ["alice", "bob"]


def test_chat_outside_the_window_is_not_participation():
    store = EventStore(maxlen=100)
    chat(store, EPOCH - 10, "early", "yes")
    chat(store, EPOCH + 5, "inside", "yes")
    chat(store, EPOCH + 90, "late", "yes")

    people = participants(store, Arm.CHAT_POLL, ["yes", "no"], EPOCH, EPOCH + 60)

    assert [p.name for p in people] == ["inside"]


@pytest.mark.parametrize("arm", [Arm.PREDICTION, Arm.CHAT_DIGEST, Arm.NOTHING])
def test_arms_we_cannot_read_participation_from_award_nobody(arm):
    """`prediction` happens inside Kick's own widget, `chat_digest` is never posted, and
    `nothing` is the control — chat replies during any of them are not participation."""
    store = EventStore(maxlen=100)
    chat(store, EPOCH + 1, "alice", "yes 🔥")

    assert participants(store, arm, ["yes", "no"], EPOCH, EPOCH + 60) == []
    assert arm not in XP_PER_ARM


def test_a_viewer_is_keyed_on_user_id_where_kick_sends_one():
    """A display name can change mid-session; the identity behind it does not."""
    store = EventStore(maxlen=100)
    chat(store, EPOCH + 1, "alice", "yes", user_id="42")
    chat(store, EPOCH + 2, "alice_renamed", "no", user_id="42")

    people = participants(store, Arm.CHAT_POLL, ["yes", "no"], EPOCH, EPOCH + 60)

    assert len(people) == 1


def test_emote_detection_does_not_fire_on_ordinary_text():
    assert not has_emote("that was a clean shot")
    assert not has_emote("")
    assert has_emote("gg 🎉")
    assert has_emote("[emote:1:x]")


# --- what it earns -----------------------------------------------------------------


def test_xp_accumulates_and_tiers_are_named_ranges_of_it():
    book = AwardBook()
    alice = [Participant("id:1", "alice")]

    for _ in range(3):
        book.grant(Arm.CHAT_POLL, alice, 10)

    assert book.standings()[0]["xp"] == 30
    assert book.standings()[0]["awards"] == 3
    assert book.standings()[0]["tier"] == tier_for(30)[0]


def test_crossing_a_threshold_is_announced_once_and_only_once():
    book = AwardBook()
    alice = [Participant("id:1", "alice")]
    first_floor = TIERS[1][0]

    crossings = []
    for _ in range(10):
        grant = book.grant(Arm.CHAT_POLL, alice, 5)
        crossings.extend(p.tier for p in grant.promotions)

    assert crossings.count(TIERS[1][1]) == 1
    assert book.standings()[0]["xp"] >= first_floor


def test_each_award_carries_the_total_it_left_the_viewer_on():
    """The Rewards tab draws a column per intervention, and a column that had to join
    against a top-20 leaderboard would print blanks for everyone below it."""
    book = AwardBook()
    alice = [Participant("id:1", "alice")]

    book.grant(Arm.CHAT_POLL, alice, 10)
    second = book.grant(Arm.CHAT_POLL, alice, 10)

    assert [(a.user, a.xp) for a in second.awarded] == [("alice", 20)]
    # ...and the tier that total lands in, so the dashboard needs no copy of the thresholds.
    assert second.awarded[0].tier == tier_for(20)[0]


def test_granting_nothing_is_not_an_award():
    book = AwardBook()

    assert book.grant(Arm.CHAT_POLL, [], 10) is None
    assert book.standings() == []


def test_standings_rank_by_xp():
    book = AwardBook()
    book.grant(Arm.QUIZ, [Participant("id:1", "alice")], 15)
    book.grant(Arm.EMOTE_RALLY, [Participant("id:2", "bob")], 5)
    book.grant(Arm.QUIZ, [Participant("id:2", "bob")], 15)

    assert [row["user"] for row in book.standings()] == ["bob", "alice"]


def test_tier_floors_ascend_and_start_at_zero():
    floors = [floor for floor, _, _ in TIERS]

    assert floors[0] == 0
    assert floors == sorted(floors)
    assert len(set(floors)) == len(floors)


# --- what the bot says -------------------------------------------------------------


def test_one_participant_gets_a_named_callout_rather_than_a_roll_call_of_one():
    book = AwardBook()
    grant = book.grant(Arm.CHAT_POLL, [Participant("id:1", "alice")], 10)

    line = award_line(grant, 10)

    assert line.startswith(AWARD_SIGIL)
    assert "@alice" in line and "more" not in line


def test_a_big_window_names_a_few_people_and_counts_the_rest():
    book = AwardBook()
    people = [Participant(f"id:{i}", f"user{i}") for i in range(40)]
    grant = book.grant(Arm.EMOTE_RALLY, people, 5)

    line = award_line(grant, 5)

    assert "@user0" in line
    assert "@user39" not in line  # a chat message is not a directory
    assert "37 more" in line


def test_a_window_never_posts_more_than_two_lines():
    """The ceiling that keeps this inside a chat rate limit, however many people took part
    and however many of them levelled up at once."""
    book = AwardBook()
    people = [Participant(f"id:{i}", f"user{i}") for i in range(40)]
    grant = book.grant(Arm.CHAT_POLL, people, TIERS[1][0])

    lines = [award_line(grant, 10), promotion_line(grant.promotions)]

    assert len([line for line in lines if line]) == 2
    assert len(grant.promotions) == 40  # all of them crossed, in one line


def test_no_promotion_line_when_nobody_levelled_up():
    assert promotion_line([]) is None


def test_award_and_promotion_lines_are_distinguishable_by_their_first_character():
    """The dashboard has nothing else to go on: on live Kick our message comes back through
    the webhook as an ordinary chat message with no room for metadata of our own."""
    book = AwardBook()
    grant = book.grant(Arm.CHAT_POLL, [Participant("id:1", "alice")], TIERS[1][0])

    assert award_line(grant, 10).startswith(AWARD_SIGIL)
    assert promotion_line(grant.promotions).startswith(PROMOTION_SIGIL)
    assert AWARD_SIGIL != PROMOTION_SIGIL
