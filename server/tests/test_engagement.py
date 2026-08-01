from datetime import datetime, timezone

import pytest

from easy_kick import engagement
from easy_kick.context import StreamContext
from easy_kick.engagement import BOT_NAME, FALLBACK_VIEWERS, EngagementMonitor
from easy_kick.models import ChatState, EventEnvelope, EventType
from easy_kick.store import EventStore


def chat(username: str, at: float, text: str = "hi",
         user_id: int | None = None) -> EventEnvelope:
    sender = {"username": username}
    if user_id is not None:
        sender["user_id"] = user_id
    return EventEnvelope(
        type=EventType.CHAT_MESSAGE_SENT,
        version="1",
        message_id=f"{username}@{at}",
        timestamp=datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
        payload={"sender": sender, "content": text},
    )


def monitor_over(events: list[EventEnvelope], viewers: int | None = None) -> EngagementMonitor:
    store = EventStore()
    for event in events:
        store.add(event)
    return EngagementMonitor(store, StreamContext(viewer_count=viewers))


def test_window_follows_envelope_timestamps_not_the_wall_clock():
    monitor = monitor_over([chat("ana", 1000), chat("bo", 1030), chat("cy", 1059),
                            chat("dee", 1500)])

    # dee is in the future relative to `now` and must not leak into the window.
    assert monitor.measure(1060).unique_chatters == 3
    # A minute later everything but dee has aged out.
    assert monitor.measure(1560).unique_chatters == 1
    # Later still, nothing is left.
    assert monitor.measure(2000).unique_chatters == 0


def test_participation_is_a_share_of_the_audience_when_viewers_are_known():
    monitor = monitor_over([chat("ana", 1000), chat("bo", 1010), chat("cy", 1020)],
                           viewers=300)
    assert monitor.measure(1030).participation == pytest.approx(3 / 300)


def test_participation_falls_back_when_viewer_count_is_unknown():
    monitor = monitor_over([chat("ana", 1000), chat("bo", 1010), chat("cy", 1020)])
    metrics = monitor.measure(1030)

    assert metrics.viewer_count is None
    assert metrics.msgs_per_min == pytest.approx(3.0)
    assert metrics.participation == pytest.approx((0.6 * 3 + 0.4 * 3) / FALLBACK_VIEWERS)


def test_our_own_chat_line_is_not_audience_engagement():
    monitor = monitor_over([chat("ana", 1000), chat(BOT_NAME, 1010, "drop a 🔥")],
                           viewers=100)
    metrics = monitor.measure(1030)

    assert metrics.unique_chatters == 1
    assert metrics.msgs_per_min == pytest.approx(1.0)


def test_the_live_posting_identity_is_excluded_by_stable_user_id():
    store, context = EventStore(), StreamContext(viewer_count=100)
    monitor = EngagementMonitor(store, context, bot_user_id="42")
    store.add(chat("renamed_bot", 1000, user_id=42))
    store.add(chat("viewer", 1010, user_id=7))

    assert monitor.measure(1030).unique_chatters == 1


def test_state_is_rated_against_the_channels_own_baseline():
    monitor = monitor_over([chat("ana", 1000)], viewers=100)
    monitor.baseline = 0.10

    assert monitor.classify(_with(monitor, 1000, 0.04)) is ChatState.LULL
    assert monitor.classify(_with(monitor, 1000, 0.10)) is ChatState.STEADY
    assert monitor.classify(_with(monitor, 1000, 0.30)) is ChatState.SPIKE


def test_the_baseline_tracks_a_channel_that_settles_at_a_new_level():
    monitor = monitor_over([], viewers=100)
    for _ in range(500):
        monitor.classify(_with(monitor, 1000, 0.20))

    assert monitor.baseline == pytest.approx(0.20, abs=0.01)
    # Once 20% is normal, 20% is no longer a spike.
    assert monitor.classify(_with(monitor, 1000, 0.20)) is ChatState.STEADY


def _with(monitor: EngagementMonitor, ts: float, participation: float):
    """A metrics row at a chosen participation, for exercising `classify` alone."""
    from dataclasses import replace
    return replace(monitor.measure(ts), participation=participation)


def badged(username: str, at: float, *badges: str, text: str = "hi") -> EventEnvelope:
    """A chat line whose sender carries Kick identity badges."""
    return EventEnvelope(
        type=EventType.CHAT_MESSAGE_SENT,
        version="1",
        message_id=f"{username}@{at}",
        timestamp=datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
        payload={
            "sender": {
                "username": username,
                "user_id": abs(hash(username)) % 10_000,
                "identity": {"badges": [{"type": b} for b in badges]},
            },
            "content": text,
        },
    )


def gift(username: str, at: float, amount: int | None) -> EventEnvelope:
    payload: dict = {"sender": {"username": username}}
    if amount is not None:
        payload["gift"] = {"amount": amount}
    return EventEnvelope(
        type=EventType.KICKS_GIFTED,
        version="1",
        message_id=f"gift:{username}@{at}",
        timestamp=datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
        payload=payload,
    )


def test_a_badged_viewer_counts_the_same_as_anyone_else_by_default():
    """The weights ship at 1.0 on purpose — a sub is one voice, like everyone else."""
    monitor = monitor_over([badged("mod", 1000, "moderator", "subscriber"),
                            badged("nobody", 1010)], viewers=100)

    assert monitor.measure(1060).participation == pytest.approx(2 / 100)


def test_badge_weighting_is_one_constant_away(monkeypatch):
    """Turning it on is editing `CHATTER_WEIGHTS`, not rewriting the measurement."""
    monkeypatch.setitem(engagement.CHATTER_WEIGHTS, "subscriber", 3.0)
    monitor = monitor_over([badged("fan", 1000, "subscriber"), badged("nobody", 1010)],
                           viewers=100)

    assert monitor.measure(1060).participation == pytest.approx(4 / 100)


def test_the_strongest_badge_wins_rather_than_the_sum(monkeypatch):
    """One person holding two badges is still one person, not a crowd."""
    monkeypatch.setitem(engagement.CHATTER_WEIGHTS, "subscriber", 2.0)
    monkeypatch.setitem(engagement.CHATTER_WEIGHTS, "moderator", 3.0)
    monitor = monitor_over([badged("modsub", 1000, "subscriber", "moderator")], viewers=100)

    assert monitor.measure(1060).participation == pytest.approx(3 / 100)


def test_a_window_names_the_people_in_it_not_only_how_many():
    """Differencing two windows is what turns a headcount into "who is new"."""
    monitor = monitor_over([chat("ana", 1000, user_id=1), chat("bo", 1030, user_id=2)])

    assert monitor.measure(1060).chatters == {"id:1", "id:2"}


def test_a_bigger_gift_is_worth_more_but_nowhere_near_proportionally():
    """Linear amounts would let one whale outweigh every other signal in the window."""
    small = monitor_over([gift("ana", 1000, 10)]).measure(1060)
    typical = monitor_over([gift("ana", 1000, 100)]).measure(1060)
    whale = monitor_over([gift("ana", 1000, 10_000)]).measure(1060)

    assert small.kicks_value < typical.kicks_value < whale.kicks_value
    assert typical.kicks_value == pytest.approx(1.0)
    assert whale.kicks_value < 3 * typical.kicks_value  # 100x the kicks, under 3x the score


def test_a_gift_with_no_amount_counts_exactly_as_the_old_headcount_did():
    """Kick need not send an amount; the fallback must not change any existing number."""
    assert monitor_over([gift("ana", 1000, None)]).measure(1060).rewards == pytest.approx(1.0)


def test_a_narrower_lookback_measures_a_narrower_slice():
    """Scoring a window has to look back exactly as far as that window was wide."""
    monitor = monitor_over([chat("old", 1000), chat("recent", 1050)])

    assert monitor.measure(1060, window_s=60).unique_chatters == 2
    assert monitor.measure(1060, window_s=20).unique_chatters == 1
