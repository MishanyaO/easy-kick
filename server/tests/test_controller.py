from datetime import datetime, timezone

from easy_kick.bandit import Decision, Posterior
from easy_kick.context import StreamContext
from easy_kick.controller import COOLDOWN_S, Controller
from easy_kick.engagement import EngagementMonitor
from easy_kick.models import BANDIT_ARMS, Arm, Autonomy, ChatState, EventEnvelope, EventType, Mode
from easy_kick.reward import WINDOW_S, RewardBook
from easy_kick.store import EventStore


class SpyBandit:
    """Always picks one arm, and remembers every update it was asked to make."""

    arms = BANDIT_ARMS

    def __init__(self, arm: Arm = Arm.EMOTE_RALLY, raises: bool = False):
        self.arm, self.raises, self.updates = arm, raises, []
        self.cells = {(s, a): Posterior() for s in ChatState for a in BANDIT_ARMS}

    def select(self, state: ChatState) -> Decision:
        if self.raises:
            raise RuntimeError("degenerate posterior")
        return Decision(state, self.arm, {}, 1.0)

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        self.updates.append((state, arm, reward))

    def snapshot(self) -> dict:
        return {"decisions": len(self.updates), "posteriors": []}


def build(arm: Arm = Arm.EMOTE_RALLY, raises: bool = False, autonomy: Autonomy = Autonomy.AUTO):
    store, context = EventStore(), StreamContext(viewer_count=500)
    monitor = EngagementMonitor(store, context)
    bandit = SpyBandit(arm, raises)
    frames, fires = [], []
    controller = Controller(
        monitor=monitor, bandit=bandit, rewards=RewardBook(monitor), context=context,
        store=store, publish=lambda t, p: frames.append((t, p)),
        perform=lambda a, s, c: fires.append((a, s, c)),
    )
    controller.autonomy = dict.fromkeys(controller.autonomy, autonomy)
    return controller, bandit, context, store, frames, fires


def chat(username: str, at: float, text: str = "hi") -> EventEnvelope:
    return EventEnvelope(type=EventType.CHAT_MESSAGE_SENT, version="1",
                         message_id=f"{username}@{at}",
                         timestamp=datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
                         payload={"sender": {"username": username}, "content": text})


def results(frames):
    return [p for t, p in frames if t == "controller.result"]


def test_a_decision_fires_opens_a_window_and_scores_it_on_close():
    controller, bandit, _, _, frames, fires = build()

    controller.tick(1000)
    assert [arm for arm, _, _ in fires] == [Arm.EMOTE_RALLY]
    assert not bandit.updates  # nothing is known until the window closes

    controller.tick(1000 + WINDOW_S)
    assert [(state, arm) for state, arm, _ in bandit.updates] == [(ChatState.STEADY,
                                                                   Arm.EMOTE_RALLY)]
    assert results(frames)[0]["outcome"] == "fired"


def test_nothing_decisions_still_open_a_window_and_update_the_posterior():
    controller, bandit, _, _, frames, fires = build(arm=Arm.NOTHING)

    controller.tick(1000)
    controller.tick(1000 + WINDOW_S)

    assert not fires
    assert [arm for _, arm, _ in bandit.updates] == [Arm.NOTHING]
    assert results(frames)[0]["outcome"] == "skipped"


def test_the_audio_gate_is_a_rail_and_not_a_decision():
    controller, bandit, context, _, _, fires = build()
    context.speaking = True

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires
    assert not bandit.updates  # a rail must never reach `nothing`'s statistics


def test_a_category_change_suppresses_fires_without_recording_a_decision():
    controller, bandit, context, _, _, fires = build()
    context.category_changed_at = 1000

    controller.tick(1010)
    assert not fires and not bandit.updates

    controller.tick(1000 + 3600)  # long past the transition
    assert fires


def test_the_cooldown_holds_the_bot_quiet_after_a_fire():
    controller, bandit, _, _, _, fires = build()
    controller.tick(1000)
    controller.tick(1000 + WINDOW_S)
    assert len(fires) == 1

    controller.tick(1000 + COOLDOWN_S - 1)  # window closed, but still inside the cooldown
    assert len(fires) == 1

    controller.tick(1000 + COOLDOWN_S + 1)
    assert len(fires) == 2


def test_a_bandit_that_raises_costs_one_tick_and_not_the_loop():
    controller, bandit, _, _, frames, fires = build(raises=True)

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires and not bandit.updates
    assert not results(frames)  # no window was ever opened
    bandit.raises = False
    controller.tick(1400)
    assert fires  # the loop survived and picks straight back up


def test_a_dismissed_card_never_fired_so_it_cannot_score_the_arm():
    controller, bandit, _, _, frames, fires = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)

    controller.tick(1000)
    action = next(p for t, p in frames if t == "controller.action")
    assert action["status"] == "suggested"
    assert not fires  # nothing has happened in chat yet

    assert controller.dismiss(action["id"])
    assert controller.vetoes[ChatState.STEADY, Arm.CHAT_POLL] == 1
    assert results(frames)[0]["outcome"] == "dismissed"

    controller.tick(1000 + WINDOW_S)
    assert not bandit.updates  # the window was voided, not scored


def test_an_approved_card_fires_and_the_window_runs_on():
    controller, bandit, _, _, frames, fires = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)

    controller.tick(1000)
    action = next(p for t, p in frames if t == "controller.action")
    assert controller.approve(action["id"], 1005)

    assert [arm for arm, _, _ in fires] == [Arm.CHAT_POLL]
    assert controller.approvals[Arm.CHAT_POLL] == 1

    controller.tick(1000 + WINDOW_S)
    assert [arm for _, arm, _ in bandit.updates] == [Arm.CHAT_POLL]
    assert results(frames)[0]["outcome"] == "fired"


def test_an_unanswered_card_voids_its_window():
    controller, bandit, _, _, frames, _ = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)

    controller.tick(1000)
    controller.tick(1000 + WINDOW_S)

    assert not bandit.updates
    assert results(frames)[0]["outcome"] == "railed"


def test_an_arm_switched_off_is_a_rail():
    controller, bandit, _, _, _, fires = build(autonomy=Autonomy.OFF)

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires and not bandit.updates


def test_the_kill_switch_stops_decisions_entirely():
    controller, bandit, _, _, _, fires = build()
    controller.enabled = False

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires and not bandit.updates


def test_a_poll_is_tallied_from_what_chat_actually_typed():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i, vote in enumerate(["1", "2", "1", "1", "banana"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"1": 3, "2": 1}


def test_one_viewer_gets_one_vote_however_many_times_they_type_it():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i in range(20):  # a single viewer trying to own the poll
        store.add(chat("spammer", 1010 + i, "1"))
    store.add(chat("someone_else", 1040, "2"))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"1": 1, "2": 1}


def test_a_repeat_voter_is_held_to_their_first_answer():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    store.add(chat("undecided", 1010, "1"))
    store.add(chat("undecided", 1020, "2"))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"1": 1, "2": 0}


def test_votes_survive_the_punctuation_real_chat_types():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i, vote in enumerate(["!1", "1)", " 1 ", "1 yes obviously", "2!"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    store.add(chat("bystander", 1020, "is 1 better than 2?"))  # a question, not a ballot
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"1": 4, "2": 1}


def test_an_open_poll_publishes_its_running_tally_every_tick():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    store.add(chat("early_bird", 1005, "1"))
    controller.tick(1010)

    polls = [p for t, p in frames if t == "controller.poll"]
    assert polls and polls[-1]["votes"] == {"1": 1, "2": 0}
    assert polls[-1]["voters"] == 1
    assert polls[-1]["closes_in_s"] == WINDOW_S - 10


def test_a_card_still_awaiting_approval_publishes_no_poll():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)

    controller.tick(1000)  # suggested, not sent — chat has been asked nothing
    store.add(chat("keen", 1005, "1"))
    controller.tick(1010)

    assert not [p for t, p in frames if t == "controller.poll"]


def test_an_arm_without_options_publishes_no_poll():
    controller, _, _, _, frames, _ = build(arm=Arm.EMOTE_RALLY)

    controller.tick(1000)
    controller.tick(1010)

    assert not [p for t, p in frames if t == "controller.poll"]


def test_quiz_answers_are_tallied_like_a_poll():
    controller, _, _, store, frames, _ = build(arm=Arm.QUIZ)

    controller.tick(1000)
    for i, vote in enumerate(["1", "2", "1"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"1": 2, "2": 1}


def test_a_buried_question_fires_a_digest_card_without_posting_or_scoring():
    controller, bandit, _, store, frames, fires = build()

    store.add(chat("alice", 1000, "when's the next raid?"))
    store.add(chat("bob", 1001, "when's the next raid?"))
    controller.tick(1010)

    assert not fires  # never posted to chat
    assert not bandit.updates  # never scored
    digests = [p for t, p in frames if t == "controller.digest"]
    assert digests and digests[0]["highlight"]["text"] == "when's the next raid?"
    assert not [p for t, p in frames if t == "controller.action"]


def test_a_single_asker_is_not_a_buried_question():
    controller, bandit, _, store, frames, fires = build()

    store.add(chat("alice", 1000, "when's the next raid?"))
    controller.tick(1010)

    assert not [p for t, p in frames if t == "controller.digest"]
    assert fires  # the bandit's own arm still fires as normal


def test_the_context_frame_carries_the_three_live_graph_series():
    controller, _, _, store, frames, _ = build()
    store.add(chat("alice", 995, "hi"))

    controller.tick(1000)

    context = next(p for t, p in frames if t == "controller.context")
    assert context["unique_chatters"] == 1
    assert context["msgs_per_min"] > 0


def test_manual_mode_never_touches_the_bandit():
    controller, bandit, _, _, _, fires = build(raises=True)
    controller.mode = Mode.MANUAL
    controller.fire_rate = {Arm.EMOTE_RALLY: 1e6}  # certain to fire this tick

    controller.tick(1000)
    assert [arm for arm, _, _ in fires] == [Arm.EMOTE_RALLY]  # bandit.select() never called

    controller.tick(1000 + WINDOW_S)
    assert not bandit.updates  # manual windows never score a posterior


def test_manual_mode_with_no_rate_set_fires_nothing():
    controller, bandit, _, _, _, fires = build()
    controller.mode = Mode.MANUAL

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires and not bandit.updates


def test_the_trust_ratchet_offers_promotion_once_an_arm_has_earned_it():
    controller, bandit, _, _, _, _ = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)
    assert not controller.promotions()

    controller.approvals[Arm.CHAT_POLL] = 8
    for state in ChatState:
        bandit.cells[state, Arm.CHAT_POLL].alpha = 9.0

    assert controller.promotions() == [Arm.CHAT_POLL]


def test_a_baseline_policy_holds_no_posteriors_and_claims_nothing():
    from easy_kick.bandit import RandomPolicy
    from easy_kick.controller import insights

    assert insights(RandomPolicy(seed=0)) == []


def test_predictions_are_never_promoted_because_they_spend_viewers_points():
    controller, bandit, _, _, _, _ = build(autonomy=Autonomy.ASK)
    controller.approvals[Arm.PREDICTION] = 50
    for state in ChatState:
        bandit.cells[state, Arm.CHAT_POLL].alpha = 9.0

    assert Arm.PREDICTION not in controller.promotions()
