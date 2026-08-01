"""The scenario is the thing we put on a screen, so what is tested here is what a judge
would look for: that it is reproducible, that nothing in it runs on a timer, and that the
numbers on the dashboard were measured from the chat rather than written down in advance."""

from collections import Counter
from functools import lru_cache

from easy_kick.bandit import Bandit
from easy_kick.context import StreamContext
from easy_kick.controller import COOLDOWN_S
from easy_kick.engagement import BOT_NAME
from easy_kick.hub import EventHub
from easy_kick.models import (
    APPROVAL_ONLY_ARMS,
    BANDIT_ARMS,
    Arm,
    Autonomy,
    ChatState,
    EventType,
    parse_timestamp,
)
from easy_kick.reward import WINDOW_S
from easy_kick.scenario import AUDIENCE, RUN_S, Scenario, catalogue
from easy_kick.store import EventStore

EPOCH = 1_750_000_000.0
NOISE_BAND = 0.005  # mirrors the client's verdict threshold in `types.ts`
# What a standalone run can actually send. `prediction` stakes viewers' Channel Points and
# is human-gated at the delivery boundary whatever the autonomy map says, so headless — with
# nobody at the keyboard to approve one — it is switched off rather than left to expire.
UNATTENDED_ARMS = tuple(
    arm for arm in BANDIT_ARMS if arm not in APPROVAL_ONLY_ARMS and arm is not Arm.NOTHING
)


class Run:
    """One complete seeded session, played headless on its own clock."""

    def __init__(self, seed: int):
        self.frames: list[tuple[str, dict]] = []
        self.store = EventStore(maxlen=4000)
        self.bandit = Bandit(seed=seed)
        self.scenario = build(
            seed, self.store, self.bandit, self.frames.append
        )
        self.events = []
        while not self.scenario.completed:
            self.events += self.scenario.step(self.scenario.next_due_in())

    def frames_of(self, kind: str) -> list[dict]:
        return [payload for name, payload in self.frames if name == f"controller.{kind}"]

    @property
    def fired(self) -> list[dict]:
        return [r for r in self.frames_of("result") if r["outcome"] == "fired"]

    def transcript(self) -> list[tuple[float, str, str]]:
        return [
            (round(event.epoch() - EPOCH, 3), event.username("sender"),
             event.payload["content"])
            for event in self.events
            if event.type == EventType.CHAT_MESSAGE_SENT
        ]

    def gaps(self, lines: list[tuple[float, str, str]]) -> list[float]:
        return [round(b[0] - a[0], 2) for a, b in zip(lines, lines[1:])]


def build(seed: int, store=None, bandit=None, record=None) -> Scenario:
    """A scenario wired to the same collaborators the app gives it, ready at t=0."""
    return Scenario(
        seed=seed,
        store=store if store is not None else EventStore(maxlen=4000),
        hub=EventHub(),
        bandit=bandit if bandit is not None else Bandit(seed=seed),
        context=StreamContext(viewer_count=640, started_at=EPOCH, is_live=True),
        publish=(lambda kind, payload: record((kind, payload))) if record else
                (lambda kind, payload: None),
        base_epoch=EPOCH,
    )


@lru_cache(maxsize=8)
def run(seed: int) -> Run:
    return Run(seed)


def verdict(result: dict) -> str:
    """The label the dashboard would print for this row."""
    if result["contaminated"]:
        return "can't tell"
    if result["engagement_delta"] > NOISE_BAND:
        return "worked"
    if result["engagement_delta"] < -NOISE_BAND:
        return "backfired"
    return "neutral"


def test_a_seed_replays_the_show_exactly_and_a_new_seed_writes_a_different_one():
    first, again, other = Run(7), Run(7), run(11)

    assert first.transcript() == again.transcript()
    assert [r["engagement_delta"] for r in first.fired] == [
        r["engagement_delta"] for r in again.fired
    ]
    # Not a script with the serial numbers filed off: another seed is another session.
    assert other.transcript() != first.transcript()
    assert [r["arm"] for r in other.fired] != [r["arm"] for r in first.fired]


def test_a_session_is_dozens_of_interventions_across_every_tactic():
    session = run(7)
    results = session.frames_of("result")

    # The production rails bind here, which is the point of running the story through them:
    # `ARM_CAP_PER_HOUR` holds each tactic to four fires an hour, so two virtual hours of
    # the three unattended tactics is two dozen interventions and not an unlimited stream.
    assert len(session.fired) >= 20
    assert {r["arm"] for r in results} == set(UNATTENDED_ARMS) | {Arm.NOTHING}
    assert {r["state"] for r in results} == set(ChatState)
    # Every fired result closes an action chat actually saw, in the order they were sent.
    # A window still open when the stream ends never resolves; that is the only slack.
    actions = [a["id"] for a in session.frames_of("action")]
    fired = [r["action_id"] for r in session.fired]
    assert actions[:len(fired)] == fired
    assert len(actions) - len(fired) <= 1
    assert len(results) >= session.scenario.decisions - 1


def test_the_bot_waits_on_the_room_rather_than_on_a_timer():
    session = run(7)
    lines = [line for line in session.transcript() if line[1] == BOT_NAME]
    gaps = session.gaps(lines)

    assert len(gaps) >= 20
    # The cooldown is a floor it may sit on, never a period it repeats: the spacing has to
    # spread well past it, because what decides the next one is what chat is doing.
    assert min(gaps) >= COOLDOWN_S
    assert max(gaps) > 2 * COOLDOWN_S
    assert len(set(gaps)) >= 10
    assert Counter(gaps).most_common(1)[0][1] < len(gaps) / 2


def test_chat_arrives_in_bursts_and_quiet_stretches_rather_than_on_a_grid():
    session = run(7)
    gaps = session.gaps(session.transcript())

    ordered = sorted(gaps)
    mean = sum(gaps) / len(gaps)

    assert len(gaps) > 2000
    # A polling clock puts every message on the same handful of offsets; an exponential
    # clock leans right — most gaps shorter than the mean, with a thin tail of quiet.
    assert Counter(gaps).most_common(1)[0][1] < len(gaps) / 10
    assert ordered[len(ordered) // 2] < mean
    assert min(gaps) < 0.5  # people talk over each other
    assert max(gaps) > 20.0  # and then nobody says anything for a while


def test_the_room_is_a_long_tail_and_the_regulars_do_not_carry_every_message():
    session = run(7)
    speakers = Counter(
        who for _, who, _ in session.transcript() if who != BOT_NAME
    )

    assert len(speakers) > 60
    assert speakers.most_common(1)[0][1] < len(session.transcript()) / 10


def test_every_verdict_the_dashboard_can_print_actually_happens():
    labels = Counter(verdict(r) for r in run(7).fired)

    assert {"worked", "neutral", "backfired"} <= set(labels)
    # And the same intervention does not always land the same way.
    lifts = {round(r["engagement_delta"], 4) for r in run(7).fired}
    assert len(lifts) > 20


def test_a_tally_is_counted_off_what_people_typed_and_nothing_else():
    session = run(7)
    polled = next(
        r for r in session.fired if r["arm"] is Arm.CHAT_POLL and sum(r["votes"].values())
    )
    action = next(
        a for a in session.frames_of("action") if a["id"] == polled["action_id"]
    )
    opened = parse_timestamp(action["ts"]).timestamp() - EPOCH
    window = [
        line for line in session.transcript() if opened <= line[0] <= opened + WINDOW_S
    ]

    # The prompt reaches chat exactly once, as a chat message like anyone else's.
    assert [text for _, who, text in window if who == BOT_NAME] == [action["body"]]
    ballots: dict[str, str] = {}
    for _, who, text in window:
        if who == BOT_NAME:
            continue
        first = text.split(maxsplit=1)[0].strip("?!.,").lower()
        if first in action["options"]:
            ballots.setdefault(who, first)  # one viewer, one vote — the first one counts
    assert sum(polled["votes"].values()) == len(ballots)
    assert polled["votes"] == {
        option: sum(choice == option for choice in ballots.values())
        for option in action["options"]
    }


def test_quiet_windows_are_the_control_every_intervention_is_read_against():
    session = run(7)
    quiet = [r for r in session.frames_of("result") if r["outcome"] == "skipped"]

    assert len(quiet) >= 8
    assert all(r["arm"] is Arm.NOTHING and not r["votes"] for r in quiet)
    assert max(r["controls"] for r in session.fired) >= 4
    # A window with nothing to compare against says so instead of reporting a lift.
    assert all(
        r["contaminated"] for r in session.fired if r["controls"] == 0
    )
    # The matched control is doing work: chat drifts on its own, so the naive before/after
    # number and the one we ship are not the same number.
    assert any(
        abs(r["lift_naive"] - r["engagement_delta"]) > NOISE_BAND for r in session.fired
    )


def test_the_policy_finds_the_table_it_is_never_shown():
    # Six sessions, not three. A spike is a short beat and the bot is deliberately reluctant
    # to interrupt one, so spike windows are the scarcest evidence in any single run — and
    # the claim here is about the world's expected value, which needs enough of them that
    # the sign is the world's and not the sampler's.
    fired = [r for seed in (7, 11, 42, 3, 19, 55) for r in run(seed).fired]
    by_state = {
        state: [r["engagement_delta"] for r in fired if r["state"] == state]
        for state in ChatState
    }
    mean = {state: sum(lifts) / len(lifts) for state, lifts in by_state.items()}

    # The hidden truth: interrupting a quiet room converts people, interrupting a clutch
    # talks over the moment they are watching. Nothing tells the bandit this.
    assert mean[ChatState.LULL] > mean[ChatState.STEADY] > mean[ChatState.SPIKE]
    assert mean[ChatState.SPIKE] < 0
    pulls = sum(cell.pulls for cell in run(7).bandit.cells.values())
    assert pulls >= 30
    assert pulls <= len(run(7).frames_of("result"))  # contaminated windows teach nothing


def test_an_arm_left_on_ask_raises_a_card_instead_of_firing():
    """The story runs under whatever rails the streamer set, because it runs through the
    same controller they set them on.

    This is the bug that made the dashboard's Insights panel dead air for a whole prepared
    run: the story used to carry its own decision loop, so every tactic auto-fired, no
    approval card was ever raised, no digest was ever surfaced, and the panel — which shows
    exactly those two things — had nothing to say from start to finish.
    """
    frames: list[tuple[str, dict]] = []
    scenario = build(7, record=frames.append)
    for arm in UNATTENDED_ARMS:
        scenario.controller.autonomy[arm] = Autonomy.ASK

    said: list[str] = []
    while not scenario.completed and not any(f["type"] == "action" for _, f in frames):
        said += [
            event.payload["content"]
            for event in scenario.step(scenario.next_due_in())
            if event.username("sender") == BOT_NAME
        ]

    card = next(f for _, f in frames if f["type"] == "action")
    assert card["autonomy"] == Autonomy.ASK
    assert card["auto_fire"] is False
    assert card["status"] == "suggested"
    # Nothing reached chat: a card waiting on the streamer has asked the room nothing.
    assert said == []
    assert scenario.interventions == 0


def test_the_kill_switch_stops_the_story_dead():
    frames: list[tuple[str, dict]] = []
    scenario = build(11, record=frames.append)
    scenario.controller.enabled = False

    while not scenario.completed:
        scenario.step(scenario.next_due_in())

    assert not [f for _, f in frames if f["type"] in ("action", "result", "digest")]
    assert scenario.interventions == 0
    # The room still runs and is still measured — it is the bot that is switched off.
    assert [f for _, f in frames if f["type"] == "context"]


def test_the_run_sheet_publishes_the_ground_truth_and_the_status_reads_out_loud():
    sheet = catalogue()

    assert sheet["scenario"] == "ranked_run"
    assert sheet["duration_s"] == RUN_S
    assert {(row["state"], row["arm"]) for row in sheet["ground_truth"]} == set(AUDIENCE)
    assert all(row["hidden_from_policy"] for row in sheet["ground_truth"])

    status = build(7).status()
    assert status["scenario"] == "ranked_run"
    assert status["match"] == 1
    assert status["beat"] == "in queue"
    assert status["decisions"] == status["interventions"] == 0
