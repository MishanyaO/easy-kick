import asyncio

import pytest

from easy_kick.context import CATEGORY_TRANSITION_S, StreamContext, poll_channel

CHANNEL = {
    "stream_title": "ranked grind",
    "category": {"name": "Counter-Strike"},
    "stream": {"is_live": True, "viewer_count": 1240, "start_time": "2026-07-25T09:00:00Z"},
}


class StubKick:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = 0

    async def get_channels(self, broadcaster_user_id=None):
        self.calls += 1
        reply = self.responses[min(self.calls - 1, len(self.responses) - 1)]
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_a_channel_row_fills_in_what_we_know():
    context = StreamContext()
    context.apply(CHANNEL, now=1000)

    assert context.viewer_count == 1240
    assert context.category == "Counter-Strike"
    assert context.stream_title == "ranked grind"
    assert context.uptime_s(context.started_at + 900) == pytest.approx(900)


def test_the_first_category_seen_is_not_a_change():
    context = StreamContext()
    context.apply(CHANNEL, now=1000)

    assert context.category_changed_at is None
    assert not context.in_transition(1000)


def test_a_category_switch_opens_a_transition_window():
    context = StreamContext()
    context.apply(CHANNEL, now=1000)
    context.apply({**CHANNEL, "category": {"name": "Just Chatting"}}, now=2000)

    assert context.category == "Just Chatting"
    assert context.in_transition(2000 + CATEGORY_TRANSITION_S - 1)
    assert not context.in_transition(2000 + CATEGORY_TRANSITION_S + 1)


async def test_a_failed_poll_degrades_to_an_unknown_viewer_count():
    context = StreamContext()
    kick = StubKick([CHANNEL], RuntimeError("kick is down"))

    task = asyncio.create_task(poll_channel(kick, context, interval_s=0.001))
    while kick.calls < 2:
        await asyncio.sleep(0)
    task.cancel()

    assert context.viewer_count is None  # degraded, not raised
    assert context.category == "Counter-Strike"  # what we already knew survives
