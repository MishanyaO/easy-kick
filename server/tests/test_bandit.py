import random

from easy_kick.bandit import (
    DECAY,
    MIN_NOTHING_PROBABILITY,
    MIN_PULLS,
    PRIOR,
    Bandit,
    ReactivePolicy,
    TimerPolicy,
)
from easy_kick.models import Arm, ChatState

TOY = {Arm.EMOTE_RALLY: 0.8, Arm.CHAT_POLL: 0.5, Arm.NOTHING: 0.3}


def play(bandit: Bandit, pulls: int, state: ChatState = ChatState.STEADY) -> list[Arm]:
    """A toy world where each arm pays a fixed probability, independent of state."""
    rng = random.Random(7)
    chosen = []
    for _ in range(pulls):
        decision = bandit.select(state)
        chosen.append(decision.arm)
        bandit.update(state, decision.arm, 1.0 if rng.random() < TOY[decision.arm] else 0.0)
    return chosen


def test_it_finds_the_best_arm_on_a_toy_world():
    bandit = Bandit(seed=0, arms=tuple(TOY))
    tail = play(bandit, 600)[-200:]

    assert tail.count(Arm.EMOTE_RALLY) > tail.count(Arm.CHAT_POLL)
    assert tail.count(Arm.EMOTE_RALLY) > tail.count(Arm.NOTHING)
    best = max(TOY, key=lambda arm: bandit.cells[ChatState.STEADY, arm].mean)
    assert best is Arm.EMOTE_RALLY


def test_a_cold_cell_falls_back_to_the_prior():
    bandit = Bandit(seed=0)
    cell = bandit.cells[ChatState.LULL, Arm.CHAT_POLL]
    cell.alpha, cell.beta = 90.0, 1.0  # a wild posterior on almost no evidence

    cell.pulls = MIN_PULLS - 1
    assert bandit._draw(ChatState.LULL, Arm.CHAT_POLL) < 0.99  # prior, not the wild cell

    cell.pulls = MIN_PULLS
    assert bandit._draw(ChatState.LULL, Arm.CHAT_POLL) > 0.9


def test_evidence_is_bounded_so_old_pulls_fade():
    bandit = Bandit(seed=0)
    for _ in range(3000):
        bandit.update(ChatState.STEADY, Arm.CHAT_POLL, 1.0)

    cell = bandit.cells[ChatState.STEADY, Arm.CHAT_POLL]
    assert cell.alpha + cell.beta < 2 * PRIOR + 1 / (1 - DECAY) + 1


def test_it_follows_a_channel_whose_taste_changes():
    bandit = Bandit(seed=0)
    for _ in range(300):
        bandit.update(ChatState.STEADY, Arm.CHAT_POLL, 1.0)
    assert bandit.cells[ChatState.STEADY, Arm.CHAT_POLL].mean > 0.9

    for _ in range(300):
        bandit.update(ChatState.STEADY, Arm.CHAT_POLL, 0.0)
    assert bandit.cells[ChatState.STEADY, Arm.CHAT_POLL].mean < 0.1


def test_propensity_is_a_probability_over_the_arms():
    bandit = Bandit(seed=0)
    decision = bandit.select(ChatState.STEADY)

    assert 0.0 <= decision.propensity <= 1.0
    assert decision.arm in bandit.arms


def test_selection_and_propensity_use_only_the_eligible_arms():
    bandit = Bandit(seed=0)
    eligible = (Arm.NOTHING, Arm.CHAT_POLL)

    decision = bandit.select(ChatState.STEADY, eligible)

    assert decision.eligible == eligible
    assert set(decision.samples) == set(eligible)
    assert decision.arm in eligible


def test_nothing_keeps_an_explicit_minimum_allocation():
    bandit = Bandit(seed=0)
    eligible = (Arm.NOTHING, Arm.CHAT_POLL)

    propensity = bandit._propensity(ChatState.STEADY, Arm.NOTHING, eligible)

    assert propensity >= MIN_NOTHING_PROBABILITY


def test_a_warm_start_restores_a_previous_run():
    trained = Bandit(seed=0, arms=tuple(TOY))
    play(trained, 200)

    fresh = Bandit(seed=1, arms=tuple(TOY))
    fresh.restore(trained.snapshot()["posteriors"])

    assert all(fresh.cells[key].alpha == cell.alpha for key, cell in trained.cells.items())
    assert all(fresh.cells[key].pulls == cell.pulls for key, cell in trained.cells.items())


def test_the_reactive_baseline_fires_on_the_moment_rather_than_on_a_cadence():
    reactive = ReactivePolicy()

    assert reactive.select(ChatState.LULL).arm is Arm.EMOTE_RALLY
    assert reactive.select(ChatState.STEADY).arm is Arm.NOTHING
    assert reactive.select(ChatState.SPIKE).arm is Arm.NOTHING


def test_the_timer_baseline_fires_on_a_cadence_and_learns_nothing():
    timer = TimerPolicy(every=3)
    arms = [timer.select(ChatState.STEADY).arm for _ in range(9)]

    assert arms.count(Arm.EMOTE_RALLY) == 3
    timer.update(ChatState.STEADY, Arm.EMOTE_RALLY, 1.0)
    assert timer.select(ChatState.STEADY).arm is Arm.NOTHING  # 10th decision, unchanged
