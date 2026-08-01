"""The scenario is the thing we put on a screen, so what is tested here is what a judge
would look for: that it is reproducible, that nothing in it runs on a timer, and that the
numbers on the dashboard were measured from the chat rather than written down in advance."""

from collections import Counter
from functools import lru_cache

import pytest

from easy_kick.awards import AWARD_SIGIL, PROMOTION_SIGIL
from easy_kick.bandit import Bandit
from easy_kick.context import StreamContext
from easy_kick.controller import COOLDOWN_S, TICK_S
from easy_kick.engagement import BOT_NAME
from easy_kick.hub import EventHub
from easy_kick.models import (
    APPROVAL_ONLY_ARMS,
    BANDIT_ARMS,
    Arm,
    Autonomy,
    ChatState,
    EventType,
    TrialOrigin,
    parse_timestamp,
)
from easy_kick.reward import WINDOW_S
from easy_kick.scenario import (
    AUDIENCE,
    TARGET,
    RESPONSE_WINDOW_S,
    RUN_S,
    SHOWCASE_AT,
    SHOWCASE_HOLD_S,
    SHOWCASE_PATIENCE,
    Scenario,
    catalogue,
)
from easy_kick.store import EventStore

EPOCH = 1_750_000_000.0
NOISE_BAND = 0.005  # mirrors the client's verdict threshold in `types.ts`
# What a standalone run can actually send. `prediction` stakes viewers' Channel Points and
# is human-gated at the delivery boundary whatever the autonomy map says, so headless — with
# nobody at the keyboard to approve one — it is switched off rather than left to expire.
UNATTENDED_ARMS = tuple(
    arm for arm in BANDIT_ARMS if arm not in APPROVAL_ONLY_ARMS and arm is not Arm.NOTHING
)


class ClickLog:
    """Stands in for the hub the app hands the scenario, keeping the taps it publishes.

    Clicks are the one thing the story sends that is neither a chat event nor part of the
    replayable session record — they go straight out to live subscribers — so this is the
    only place they can be observed at all.
    """

    def __init__(self):
        self.frames: list[dict] = []

    def publish(self, event) -> None:
        if event.type == "controller.clicks":
            self.frames.append({**event.payload, "at": event.epoch() - EPOCH})

    @property
    def points(self) -> list[list[float]]:
        return [point for frame in self.frames for point in frame["points"]]

    def between(self, start: float, end: float) -> list[list[float]]:
        return [p for f in self.frames if start <= f["at"] < end for p in f["points"]]


def is_intervention(text: str) -> bool:
    """The bot's own prompt, as opposed to a participation award.

    Both are `gambit` lines in the same chat, so "what the bot said" no longer means "what
    the bot asked". Everything about pacing and cooldowns is a claim about the prompts.
    """
    return not text.startswith((AWARD_SIGIL, PROMOTION_SIGIL))


class Run:
    """One complete seeded session, played headless on its own clock."""

    def __init__(self, seed: int):
        self.frames: list[tuple[str, dict]] = []
        self.store = EventStore(maxlen=4000)
        self.bandit = Bandit(seed=seed)
        self.clicks = ClickLog()
        self.scenario = build(
            seed, self.store, self.bandit, self.frames.append, hub=self.clicks
        )
        self.events = []
        self.held_at: list[float] = []
        while not self.scenario.completed:
            self.events += self.scenario.step(self.scenario.next_due_in())
            if self.scenario.hold:
                # Stand in for the runner, which pauses on a hold and clears it. Here the
                # session plays straight through, so the only record is where it asked.
                self.held_at.append(self.scenario.t)
                self.scenario.hold = False

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


def build(seed: int, store=None, bandit=None, record=None, hub=None) -> Scenario:
    """A scenario wired to the same collaborators the app gives it, ready at t=0."""
    return Scenario(
        seed=seed,
        store=store if store is not None else EventStore(maxlen=4000),
        hub=hub if hub is not None else EventHub(),
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
    assert first.clicks.points == again.clicks.points
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
    lines = [
        line
        for line in session.transcript()
        if line[1] == BOT_NAME and is_intervention(line[2])
    ]
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

    # The prompt reaches chat exactly once, as a chat message like anyone else's. Award
    # lines are the bot too, but they are not the prompt and carry no ballot.
    assert [
        text for _, who, text in window if who == BOT_NAME and is_intervention(text)
    ] == [action["body"]]
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


def test_the_video_is_empty_until_a_rally_asks_for_it():
    session = run(7)
    rallies = [
        parse_timestamp(a["ts"]).timestamp() - EPOCH
        for a in session.frames_of("action")
        if a["kind"] is Arm.CLICK_RALLY
        and a["id"] in {r["action_id"] for r in session.fired}
    ]

    assert rallies and session.clicks.frames
    # Nobody taps a stream unprompted. Every point on the map is inside the window of a
    # rally that was actually sent — so a map with anything on it is the arm's doing, and
    # a run that never plays one shows the frame the streamer's viewers see.
    assert all(
        any(at <= frame["at"] < at + RESPONSE_WINDOW_S for at in rallies)
        for frame in session.clicks.frames
    )
    assert not session.clicks.between(0.0, rallies[0])


def test_the_room_taps_the_video_and_a_tap_is_never_counted_as_chat():
    session = run(7)
    points = session.clicks.points

    assert len(points) > 500
    assert all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in points)
    # A tap is engagement, not a message. Letting one into the store would put it in the
    # participation the reward is read off — measuring our own heatmap as if the room had
    # started talking — so clicks reach live subscribers and nothing else.
    assert not session.store.query(event_type="controller.clicks")
    assert all(
        event.type == EventType.CHAT_MESSAGE_SENT for event in session.store.iter_recent()
    )
    # Nor are they part of the session record a late-joining tab replays: a heatmap is
    # "where the room is looking", and an hour of old attention repainted at once is not.
    assert not session.frames_of("clicks")
    # A map is only worth drawing because attention is uneven: most of the room lands on
    # what it was pointed at, the rest tap wherever they like, because people do.
    x, y = TARGET
    near = sum(abs(px - x) < 0.1 and abs(py - y) < 0.1 for px, py in points)
    assert 0.7 < near / len(points) < 0.95


def test_a_click_rally_turns_the_map_into_a_point():
    session = run(7)
    rally = next(
        a for a in session.frames_of("action")
        if a["kind"] is Arm.CLICK_RALLY
        and a["id"] in {r["action_id"] for r in session.fired}
    )
    sent = parse_timestamp(rally["ts"]).timestamp() - EPOCH

    answered = session.clicks.between(sent, sent + RESPONSE_WINDOW_S)
    # The response the demo is built on: asked to tap, the room taps, and it does so hard
    # enough to fill a frame that was blank a second earlier.
    assert not session.clicks.between(sent - RESPONSE_WINDOW_S, sent)
    assert len(answered) > 200
    # ...and it aims. Scattered taps smear across the frame; a rally lands on one spot,
    # which is what makes the heatmap readable as an answer rather than as traffic.
    x, y = TARGET
    on_target = sum(
        abs(px - x) < 0.05 and abs(py - y) < 0.05 for px, py in answered
    ) / len(answered)
    assert on_target > 0.65
    # And it starts immediately, so the map is already filling while the line is on screen.
    assert session.clicks.between(sent, sent + 5)


def test_the_stream_stops_on_the_first_click_rally_and_nothing_runs_over_it():
    session = run(7)
    sent = [
        (parse_timestamp(a["ts"]).timestamp() - EPOCH, a)
        for a in session.frames_of("action")
        if a["id"] in {r["action_id"] for r in session.fired}
    ]
    rally_at, _ = next((at, a) for at, a in sent if a["kind"] is Arm.CLICK_RALLY)

    # One hold in the run, on the first rally that reached chat — whoever chose it. The
    # policy playing one of its own accord is the same thing worth stopping on as the one
    # the showcase asks for, and a run that let it pass carried on into a quiz while the
    # map everybody was looking at was still red.
    assert len(session.held_at) == 1
    # It holds on the finished thing: the room has stopped tapping and the window has
    # closed, so the feed's top row is the rally itself rather than whatever preceded it.
    assert session.held_at[0] == pytest.approx(rally_at + SHOWCASE_HOLD_S, abs=TICK_S)
    assert session.held_at[0] >= rally_at + RESPONSE_WINDOW_S
    assert session.held_at[0] >= rally_at + WINDOW_S
    # And nothing else is sent between the rally and the hold.
    assert not [a for at, a in sent if rally_at < at <= session.held_at[0]]


def test_the_showcase_asks_for_a_rally_when_the_policy_has_not_played_one():
    session = run(7)
    cued = [
        r for r in session.fired
        if r["arm"] is Arm.CLICK_RALLY and r["origin"] is TrialOrigin.MANUAL
    ]

    # Asked for at most once, and only because the run had not produced one by itself.
    assert len(cued) <= 1
    if not cued:
        return
    action = next(a for a in session.frames_of("action") if a["id"] == cued[0]["action_id"])
    sent = parse_timestamp(action["ts"]).timestamp() - EPOCH
    assert SHOWCASE_AT <= sent < SHOWCASE_AT + SHOWCASE_PATIENCE + 300
    # It waits for a room worth asking, which is most of why it is worth watching — and
    # gives up waiting after `SHOWCASE_PATIENCE`, because a beat nobody gets to see is
    # worse than one played over a room that happens to be talking.
    assert (
        cued[0]["state"] is ChatState.LULL
        or sent >= SHOWCASE_AT + SHOWCASE_PATIENCE
    )
    # ...and for a quiet window to read the result against, so the map does not land next
    # to a row that says `can't tell`.
    assert not cued[0]["contaminated"]
    # Cueing is not teaching: a manual trial never updates a posterior, so the showcase
    # cannot put its own answer into the table the policy is supposed to be learning.
    assert cued[0]["origin"] is TrialOrigin.MANUAL


def test_a_cued_arm_still_obeys_the_rails_it_would_have_obeyed_anyway():
    frames: list[tuple[str, dict]] = []
    bandit = Bandit(seed=7)
    scenario = build(7, bandit=bandit, record=frames.append)
    controller = scenario.controller
    controller.autonomy = dict.fromkeys(controller.autonomy, Autonomy.AUTO)

    assert controller.cue(Arm.CLICK_RALLY, scenario.now) is True
    # Not twice: the window it just opened is the same rail that stops the policy from
    # talking over its own measurement.
    assert controller.cue(Arm.CLICK_RALLY, scenario.now) is False
    # And an arm the streamer switched off stays off — a cue is a request, not an override.
    controller.autonomy[Arm.CLICK_RALLY] = Autonomy.OFF
    assert controller.cue(Arm.CLICK_RALLY, scenario.now) is False

    scenario.step(WINDOW_S + TICK_S)
    closed = next(payload for kind, payload in frames if kind == "controller.result")
    assert closed["arm"] is Arm.CLICK_RALLY
    # Cued, therefore not evidence: it is logged as the streamer's move and closing it
    # leaves the posterior exactly where it was.
    assert closed["origin"] is TrialOrigin.MANUAL
    assert bandit.cells[closed["state"], Arm.CLICK_RALLY].pulls == 0


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
    # Off, so the showcase stays out of it: a cued arm is one the streamer asked for by
    # name and is delivered without a card, which is not what this is about.
    scenario.controller.autonomy[Arm.CLICK_RALLY] = Autonomy.OFF

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
