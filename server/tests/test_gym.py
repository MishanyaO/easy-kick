from datetime import datetime, timezone

from easy_kick.gym import Gym, simulate
from easy_kick.models import Arm, ChatState, EventType
from easy_kick.store import EventStore


def signature(events):
    return [(e.type, e.timestamp, e.payload.get("content"), e.username("sender"))
            for e in events]


def world(seed: int) -> Gym:
    return Gym(seed=seed, base_epoch=1_750_000_000.0)


def test_the_same_seed_gives_the_same_world():
    assert signature(_run(world(11), 300)) == signature(_run(world(11), 300))
    assert signature(_run(world(11), 300)) != signature(_run(world(12), 300))


def test_twin_worlds_stay_identical_until_one_of_them_is_fired_into():
    gym = world(5)
    gym.run(300)
    quiet, fired = gym.fork(), gym.fork()

    assert signature(_run(quiet, 60)) == signature(_run(fired, 60))

    fired.fire(Arm.EMOTE_RALLY, ChatState.LULL)
    assert signature(_run(quiet, 60)) != signature(_run(fired, 60))
    assert fired.participation() > quiet.participation()


def test_a_fork_never_writes_into_the_world_it_came_from():
    store = EventStore()
    gym = Gym(seed=5, store=store, base_epoch=1_750_000_000.0)
    gym.run(120)
    before = store.stats()["events"]

    gym.fork().run(600)

    assert store.stats()["events"] == before


def test_events_are_stamped_with_virtual_time():
    gym = world(5)
    gym.run(3600)
    events = gym.step(5.0)

    stamped = datetime.fromisoformat(events[0].timestamp.replace("Z", "+00:00"))
    assert stamped.timestamp() == gym.now
    # An hour of virtual time really did pass, whatever the wall clock did.
    assert gym.t >= 3600


def test_events_reach_the_store_through_the_real_path():
    store = EventStore()
    gym = Gym(seed=5, store=store, base_epoch=1_750_000_000.0)
    gym.run(300)

    kinds = {ev.type for ev in store.iter_recent()}
    assert EventType.CHAT_MESSAGE_SENT in kinds
    assert store.stats()["events"] > 0


def test_chat_habituates_to_a_repeated_arm():
    gym = world(9)
    gym.run(600)

    first = gym.true_effect(Arm.EMOTE_RALLY, ChatState.LULL)
    for _ in range(4):
        gym.fire(Arm.EMOTE_RALLY, ChatState.LULL)
        gym.run(120)
    fifth = gym.true_effect(Arm.EMOTE_RALLY, ChatState.LULL)

    assert fifth < first


def test_a_mistimed_arm_suppresses_chat_rather_than_merely_failing_to_help():
    gym = world(9)
    gym.run(600)

    # Chat mid-spike is already saying what it wants to; talking over it deflates the moment.
    assert gym.true_effect(Arm.EMOTE_RALLY, ChatState.SPIKE) < 0
    assert gym.true_effect(Arm.EMOTE_RALLY, ChatState.LULL) > 0
    # An arm nobody in chat cares about is neither help nor harm.
    assert gym.true_effect(Arm.NOTHING, ChatState.LULL) == 0


def test_a_headless_run_produces_scored_decisions():
    run = simulate(seed=3, decisions=12, policy="gambit")

    assert len(run["results"]) == 12
    assert all(0.0 <= r["reward"] <= 1.0 for r in run["results"])
    assert run["hours"] > 0
    # The bandit only ever saw the observational estimate; truth was never computed.
    assert all(r["lift_true"] is None for r in run["results"])


def test_ground_truth_is_available_but_only_when_asked_for():
    run = simulate(seed=3, decisions=12, policy="gambit", truth=True)

    assert all(r["lift_true"] is not None for r in run["results"])
    assert all(r["lift_true"] == 0.0 for r in run["results"] if r["arm"] == Arm.NOTHING)


def _run(gym: Gym, duration_s: float):
    events = []
    for _ in range(int(duration_s / 5)):
        events += gym.step(5.0)
    return events


def test_a_poll_gets_answered_by_the_people_it_reaches():
    """The world fakes the chat, never the counting: personas type an option, and the
    controller's own parser has to find the votes in the message stream."""
    gym = Gym(seed=5)
    gym.run(120.0)  # let the audience warm up

    gym.fire(Arm.CHAT_POLL, ChatState.LULL, ["1", "2"])
    said = []
    for _ in range(12):
        said += [e.payload["content"] for e in gym.step(5.0)
                 if e.type == EventType.CHAT_MESSAGE_SENT]

    ballots = [text for text in said if text in {"1", "2"}]
    assert ballots, "nobody answered the poll"
    assert set(ballots) == {"1", "2"}, "a real chat splits; this world only picked one side"


def test_an_arm_with_no_options_leaves_chat_talking_normally():
    gym = Gym(seed=5)
    gym.run(120.0)

    gym.fire(Arm.EMOTE_RALLY, ChatState.LULL)
    said = [e.payload["content"] for _ in range(6) for e in gym.step(5.0)
            if e.type == EventType.CHAT_MESSAGE_SENT]

    assert said and not [t for t in said if t in {"1", "2"}]
