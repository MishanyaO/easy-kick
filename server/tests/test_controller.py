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
        self.last_eligible = None
        self.cells = {(s, a): Posterior() for s in ChatState for a in BANDIT_ARMS}

    def select(self, state: ChatState, eligible=BANDIT_ARMS) -> Decision:
        if self.raises:
            raise RuntimeError("degenerate posterior")
        self.last_eligible = tuple(eligible)
        arm = self.arm if self.arm in eligible else eligible[0]
        return Decision(state, arm, {}, 1.0, tuple(eligible))

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        self.updates.append((state, arm, reward))

    def snapshot(self) -> dict:
        return {"decisions": len(self.updates), "posteriors": []}


def build(arm: Arm = Arm.EMOTE_RALLY, raises: bool = False, autonomy: Autonomy = Autonomy.AUTO):
    store, context = EventStore(), StreamContext(viewer_count=500)
    monitor = EngagementMonitor(store, context)
    bandit = SpyBandit(arm, raises)
    frames, fires = [], []

    def perform(action_id, selected_arm, state, card):
        fires.append((selected_arm, state, card))
        return True

    controller = Controller(
        monitor=monitor, bandit=bandit, rewards=RewardBook(monitor), context=context,
        store=store, publish=lambda t, p: frames.append((t, p)),
        perform=perform,
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


def prime_control(controller: Controller, now: float = 800) -> None:
    window = controller._rewards.open(
        "control", ChatState.STEADY, Arm.NOTHING, now, fired=False
    )
    controller._rewards.close(window, now + WINDOW_S)


def test_a_decision_fires_opens_a_window_and_scores_it_on_close():
    controller, bandit, _, _, frames, fires = build()
    prime_control(controller)

    controller.tick(1000)
    assert [arm for arm, _, _ in fires] == [Arm.EMOTE_RALLY]
    assert not bandit.updates  # nothing is known until the window closes

    controller.tick(1000 + WINDOW_S)
    assert [(state, arm) for state, arm, _ in bandit.updates] == [(ChatState.STEADY,
                                                                   Arm.EMOTE_RALLY)]
    assert results(frames)[0]["outcome"] == "fired"
    assert results(frames)[0]["contaminated"] is None


def test_a_trial_in_the_previous_actions_shadow_does_not_train():
    controller, bandit, _, _, frames, _ = build()
    prime_control(controller)

    controller.tick(1000)
    controller.tick(1000 + WINDOW_S)
    assert len(bandit.updates) == 1

    controller.tick(1091)  # past the 90s cooldown, still inside the 120s shadow
    controller.tick(1091 + WINDOW_S)

    assert len(bandit.updates) == 1
    assert results(frames)[1]["contaminated"]


def test_nothing_decisions_still_open_a_window_and_update_the_posterior():
    controller, bandit, _, _, frames, fires = build(arm=Arm.NOTHING)

    controller.tick(1000)
    controller.tick(1000 + WINDOW_S)
    assert not bandit.updates  # the first quiet window establishes the control
    controller.tick(1000 + 2 * WINDOW_S)

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


def test_an_approved_card_starts_a_fresh_window_and_stays_observational():
    controller, bandit, _, _, frames, fires = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)
    prime_control(controller)

    controller.tick(1000)
    action = next(p for t, p in frames if t == "controller.action")
    assert controller.approve(action["id"], 1005)

    assert [arm for arm, _, _ in fires] == [Arm.CHAT_POLL]
    assert controller.approvals[Arm.CHAT_POLL] == 1

    controller.tick(1000 + WINDOW_S)
    assert not results(frames)  # approval at 1005 means the trial closes at 1065
    controller.tick(1005 + WINDOW_S)
    assert not bandit.updates  # streamer-approved timing is not randomized evidence
    assert results(frames)[0]["origin"] == "approved"
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


def test_a_disabled_arm_is_removed_before_selection():
    controller, bandit, _, _, _, fires = build(arm=Arm.CHAT_POLL)
    controller.autonomy[Arm.CHAT_POLL] = Autonomy.OFF

    controller.tick(1000)

    assert Arm.CHAT_POLL not in bandit.last_eligible
    assert all(arm is not Arm.CHAT_POLL for arm, _, _ in fires)


def test_nothing_cannot_be_disabled_because_it_is_the_control():
    controller, bandit, _, _, _, _ = build(arm=Arm.NOTHING)
    controller.autonomy[Arm.NOTHING] = Autonomy.OFF

    controller.tick(1000)

    assert Arm.NOTHING in bandit.last_eligible


def test_a_failed_delivery_opens_no_trial_and_updates_nothing():
    controller, bandit, _, _, frames, _ = build()
    controller.perform = lambda action_id, arm, state, card: False

    controller.tick(1000)
    action = next(p for t, p in frames if t == "controller.action")
    assert controller._window is None

    assert controller.delivery_failed(action["id"], "Kick rejected it")
    controller.tick(1000 + WINDOW_S)

    assert not bandit.updates
    assert results(frames)[0]["outcome"] == "send_failed"
    assert results(frames)[0]["contaminated"] == "Kick rejected it"


def test_live_controller_waits_for_channel_and_warmup_readiness():
    controller, _, context, _, _, fires = build()
    controller._require_live = True
    controller._warmup_s = 60
    context.started_at = 1000

    context.is_live = False
    controller.tick(1100)
    context.is_live = True
    controller.tick(1050)
    assert not fires

    controller.tick(1060)
    assert fires


def test_the_kill_switch_stops_decisions_entirely():
    controller, bandit, _, _, _, fires = build()
    controller.enabled = False

    for t in range(1000, 1400, 10):
        controller.tick(t)

    assert not fires and not bandit.updates


def test_a_poll_is_tallied_from_what_chat_actually_typed():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i, vote in enumerate(["yes", "no", "yes", "yes", "banana"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"yes": 3, "no": 1}


def test_one_viewer_gets_one_vote_however_many_times_they_type_it():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i in range(20):  # a single viewer trying to own the poll
        store.add(chat("spammer", 1010 + i, "yes"))
    store.add(chat("someone_else", 1040, "no"))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"yes": 1, "no": 1}


def test_a_repeat_voter_is_held_to_their_first_answer():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    store.add(chat("undecided", 1010, "yes"))
    store.add(chat("undecided", 1020, "no"))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"yes": 1, "no": 0}


def test_votes_survive_the_punctuation_real_chat_types():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    for i, vote in enumerate(["!yes", "yes)", " yes ", "yes obviously", "no!"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    store.add(chat("bystander", 1020, "is yes better than no?"))  # a question, not a ballot
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"yes": 4, "no": 1}


def test_an_open_poll_publishes_its_running_tally_every_tick():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL)

    controller.tick(1000)
    store.add(chat("early_bird", 1005, "yes"))
    controller.tick(1010)

    polls = [p for t, p in frames if t == "controller.poll"]
    assert polls and polls[-1]["votes"] == {"yes": 1, "no": 0}
    assert polls[-1]["voters"] == 1
    assert polls[-1]["closes_in_s"] == WINDOW_S - 10


def test_a_card_still_awaiting_approval_publishes_no_poll():
    controller, _, _, store, frames, _ = build(arm=Arm.CHAT_POLL, autonomy=Autonomy.ASK)

    controller.tick(1000)  # suggested, not sent — chat has been asked nothing
    store.add(chat("keen", 1005, "yes"))
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
    for i, vote in enumerate(["buff", "debuff", "buff"]):
        store.add(chat(f"voter{i}", 1010 + i, vote))
    controller.tick(1000 + WINDOW_S)

    assert results(frames)[0]["votes"] == {"buff": 2, "debuff": 1}


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
    prime_control(controller)
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
