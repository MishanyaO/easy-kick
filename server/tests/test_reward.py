import pytest

from easy_kick.engagement import Metrics
from easy_kick.models import Arm, ChatState
from easy_kick.reward import CONTAMINATION_S, WINDOW_S, RewardBook


class StubMonitor:
    """Participation on demand, so these tests are about the control pool and nothing else."""

    def __init__(self, participation: float = 0.10):
        self.participation = participation
        self.chatters: frozenset[str] = frozenset()

    def measure(self, now: float, window_s: float | None = None) -> Metrics:
        return Metrics(ts=now, unique_chatters=len(self.chatters), msgs_per_min=0.0,
                       redemptions=0, kicks_gifted=0, follows=0, viewer_count=1000,
                       participation=self.participation,
                       window_s=window_s or WINDOW_S, chatters=self.chatters)


def close_window(book: RewardBook, monitor: StubMonitor, at: float, arm: Arm,
                 before: float, after: float, state: ChatState = ChatState.STEADY):
    monitor.participation = before
    window = book.open(f"w{at}", state, arm, at, fired=arm is not Arm.NOTHING)
    monitor.participation = after
    return window, book.close(window, at + WINDOW_S)


def test_the_matched_control_subtracts_the_drift_chat_had_anyway():
    monitor = StubMonitor()
    book = RewardBook(monitor)

    # Three clean `nothing` windows, each recovering by 2 points on its own.
    for i in range(3):
        close_window(book, monitor, 1000 + i * 200, Arm.NOTHING, before=0.08, after=0.10)

    _, outcome = close_window(book, monitor, 5000, Arm.EMOTE_RALLY, before=0.05, after=0.13)

    assert outcome.lift_naive == pytest.approx(0.08)  # all of it credited to us
    assert outcome.lift == pytest.approx(0.08 - 0.02)  # minus the recovery we did not cause


def test_a_policy_that_always_fires_in_a_state_has_no_control_there():
    monitor = StubMonitor()
    book = RewardBook(monitor)

    # Never a clean window in this state, so there is no drift to subtract and `matched`
    # collapses onto `naive`. Exploration is what buys the control group.
    _, outcome = close_window(book, monitor, 1000, Arm.EMOTE_RALLY, before=0.05, after=0.13)

    assert outcome.lift == outcome.lift_naive


def test_the_naive_control_is_the_level_just_before_the_fire():
    monitor = StubMonitor()
    book = RewardBook(monitor)
    _, outcome = close_window(book, monitor, 1000, Arm.EMOTE_RALLY, before=0.06, after=0.09)

    assert outcome.lift_naive == pytest.approx(0.03)


def test_contaminated_windows_are_excluded_from_the_pool_but_still_scored():
    monitor = StubMonitor()
    book = RewardBook(monitor)
    book.note_fire(1000)

    # Opens inside the contamination shadow: it carries the last fire's tail.
    window, outcome = close_window(book, monitor, 1000 + CONTAMINATION_S - 10, Arm.NOTHING,
                                   before=0.30, after=0.30)
    assert window.contaminated
    assert outcome.reward > 0  # still a decision, still scored

    # The pool is untouched, so a later window still falls back to its own naive control.
    _, later = close_window(book, monitor, 9000, Arm.EMOTE_RALLY, before=0.10, after=0.12)
    assert later.lift == pytest.approx(later.lift_naive)


def test_a_clean_window_past_the_shadow_does_join_the_pool():
    monitor = StubMonitor()
    book = RewardBook(monitor)
    book.note_fire(1000)

    window, _ = close_window(book, monitor, 1000 + CONTAMINATION_S + 1, Arm.NOTHING,
                             before=0.20, after=0.24)
    assert not window.contaminated

    _, later = close_window(book, monitor, 9000, Arm.EMOTE_RALLY, before=0.10, after=0.25)
    assert later.lift_naive == pytest.approx(0.15)
    assert later.lift == pytest.approx(0.15 - 0.04)  # the pooled drift is now subtracted


def test_one_freak_window_cannot_own_a_posterior():
    monitor = StubMonitor()
    book = RewardBook(monitor)

    # The first minutes of a stream: chat ramps from nearly nothing, so the relative lift
    # against the pre-window level is enormous and means nothing.
    _, cold_start = close_window(book, monitor, 1000, Arm.EMOTE_RALLY,
                                 before=0.0001, after=0.05)

    assert cold_start.lift > 0
    assert cold_start.reward < 0.999  # bounded, so the next real window can still move it


def test_nothing_windows_carry_no_fire_cost():
    monitor = StubMonitor()
    quiet = RewardBook(monitor)
    loud = RewardBook(monitor)

    _, doing_nothing = close_window(quiet, monitor, 1000, Arm.NOTHING, before=0.10, after=0.10)
    _, intervening = close_window(loud, monitor, 1000, Arm.EMOTE_RALLY, before=0.10, after=0.10)

    # Identical chat, so the only difference is the price of interrupting.
    assert doing_nothing.lift == intervening.lift
    assert doing_nothing.reward > intervening.reward
    assert doing_nothing.reward == pytest.approx(0.5, abs=0.01)


def test_a_contaminated_window_says_why_it_cannot_be_attributed():
    monitor = StubMonitor()
    book = RewardBook(monitor)
    book.note_fire(1000)

    _, outcome = close_window(book, monitor, 1000 + CONTAMINATION_S - 10, Arm.NOTHING,
                              before=0.30, after=0.30)

    assert outcome.contaminated and "still responding" in outcome.contaminated


def test_the_first_window_of_a_state_admits_it_has_no_control_to_compare_against():
    """Until a clean window exists, `lift` IS `lift_naive` — the biased estimator wearing
    the matched label. Saying so is the difference between honest and merely confident."""
    monitor = StubMonitor()
    book = RewardBook(monitor)

    _, first = close_window(book, monitor, 1000, Arm.EMOTE_RALLY, before=0.10, after=0.20)

    assert first.controls == 0
    assert first.contaminated and "nothing to compare against" in first.contaminated
    assert first.lift == pytest.approx(first.lift_naive)


def test_a_window_with_a_real_control_behind_it_is_attributable():
    monitor = StubMonitor()
    book = RewardBook(monitor)
    close_window(book, monitor, 1000, Arm.NOTHING, before=0.20, after=0.24)  # a clean control

    _, outcome = close_window(book, monitor, 9000, Arm.EMOTE_RALLY, before=0.10, after=0.25)

    assert outcome.controls == 1
    assert outcome.contaminated is None


def test_new_voices_score_above_the_same_people_talking_more():
    """Chat churns, so a flat headcount hides the viewers an intervention actually pulled in.

    Both windows move participation by the same amount; only one of them did it with people
    who were not talking before.
    """
    monitor = StubMonitor()
    book = RewardBook(monitor)

    monitor.chatters = frozenset({"id:1", "id:2"})
    window = book.open("regulars", ChatState.STEADY, Arm.EMOTE_RALLY, 1000, fired=True)
    monitor.participation = 0.12
    same_crowd = book.close(window, 1000 + WINDOW_S)

    monitor.participation, monitor.chatters = 0.10, frozenset({"id:1", "id:2"})
    window = book.open("newcomers", ChatState.STEADY, Arm.EMOTE_RALLY, 3000, fired=True)
    monitor.participation = 0.12
    monitor.chatters = frozenset({"id:1", "id:2", "id:3", "id:4"})
    fresh_voices = book.close(window, 3000 + WINDOW_S)

    assert fresh_voices.activated == 2 and same_crowd.activated == 0
    assert fresh_voices.reward > same_crowd.reward


def test_answering_the_question_the_bot_asked_counts_toward_its_score():
    """The one signal here that is attributable by construction rather than by timing."""
    monitor = StubMonitor()
    book = RewardBook(monitor)

    window = book.open("quiet", ChatState.STEADY, Arm.CHAT_POLL, 1000, fired=True)
    ignored = book.close(window, 1000 + WINDOW_S, voters=0)
    window = book.open("answered", ChatState.STEADY, Arm.CHAT_POLL, 3000, fired=True)
    answered = book.close(window, 3000 + WINDOW_S, voters=40)

    assert answered.voters == 40
    assert answered.reward > ignored.reward


def test_a_warm_start_restores_the_controls_a_previous_run_bought():
    """Silence is expensive to collect, and a cold pool cannot attribute anything."""
    monitor = StubMonitor()
    book = RewardBook(monitor)
    for i in range(3):
        close_window(book, monitor, 1000 + i * 200, Arm.NOTHING, before=0.08, after=0.10)

    fresh = RewardBook(StubMonitor())
    fresh.restore(book.snapshot()["controls"])

    assert fresh._drift(ChatState.STEADY, WINDOW_S) == pytest.approx(
        book._drift(ChatState.STEADY, WINDOW_S)
    )
    assert fresh.control_deficit(ChatState.STEADY) == 0.0


def test_a_state_with_no_controls_reports_a_full_deficit():
    """What the bot reads to decide how much silence it still has to buy."""
    monitor = StubMonitor()
    book = RewardBook(monitor)

    assert book.control_deficit(ChatState.STEADY) == 1.0
    close_window(book, monitor, 1000, Arm.NOTHING, before=0.08, after=0.10)
    assert book.control_deficit(ChatState.STEADY) < 1.0


def test_an_arms_window_can_be_wider_than_the_default():
    """The width is per-arm, and the pool a control lands in follows the width it was
    measured at — a 60s quiet window is not a control for a wider treatment."""
    monitor = StubMonitor()
    book = RewardBook(monitor)

    window = book.open("wide", ChatState.STEADY, Arm.QUIZ, 1000, fired=True, window_s=90.0)

    assert window.length == 90.0 and window.closes_at == 1090.0
