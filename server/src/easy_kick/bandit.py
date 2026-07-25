"""Thompson sampling over (chat state × arm) Beta posteriors, plus the baselines we
compare against. Stdlib only.

Thompson rather than ε-greedy or UCB: it takes delayed, batched rewards without any
awkwardness, and a narrowing distribution is something you can actually put on a screen.
"""

import random
from dataclasses import dataclass, field

from .models import BANDIT_ARMS, Arm, ChatState

PRIOR = 1.0
# Applied to a cell on its own update, so evidence fades after ~100 pulls *of that arm*.
# Decaying the whole table on every update instead would burn a cell's evidence fifteen
# times faster than it accumulates, and nothing would separate inside a stream.
DECAY = 0.99
MIN_PULLS = 3  # below this a cell is untrusted and we sample the prior instead
PROPENSITY_SAMPLES = 200


@dataclass
class Posterior:
    alpha: float = PRIOR
    beta: float = PRIOR
    pulls: int = 0

    @property
    def mean(self) -> float:
        return self.alpha / (self.alpha + self.beta)


@dataclass(frozen=True)
class Decision:
    state: ChatState
    arm: Arm
    samples: dict[Arm, float]
    propensity: float

    def frame(self) -> dict:
        return {"state": self.state, "samples": self.samples,
                "chosen": self.arm, "propensity": self.propensity}


class Bandit:
    def __init__(self, seed: int | None = None, arms=BANDIT_ARMS, decay: float = DECAY):
        self._rng = random.Random(seed)
        self._decay = decay
        self.arms = tuple(arms)
        self.cells = {(s, a): Posterior() for s in ChatState for a in self.arms}
        self.decisions = 0

    def select(self, state: ChatState) -> Decision:
        samples = {arm: self._draw(state, arm) for arm in self.arms}
        arm = max(samples, key=samples.__getitem__)
        self.decisions += 1
        return Decision(state, arm, samples, self._propensity(state, arm))

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        """Fold a reward in [0, 1] into the posterior.

        The Bernoulli trick: flip a coin with p = reward and count it, which keeps Beta
        conjugate without pretending the reward was ever binary.
        """
        cell = self.cells[state, arm]
        cell.alpha = PRIOR + (cell.alpha - PRIOR) * self._decay  # toward the prior, never 0
        cell.beta = PRIOR + (cell.beta - PRIOR) * self._decay
        if self._rng.random() < reward:
            cell.alpha += 1
        else:
            cell.beta += 1
        cell.pulls += 1

    def snapshot(self) -> dict:
        """The `controller.bandit` payload, and the format `restore` reads back."""
        return {
            "decisions": self.decisions,
            "posteriors": [
                {"state": state, "arm": arm, "alpha": cell.alpha, "beta": cell.beta,
                 "mean": cell.mean, "pulls": cell.pulls}
                for (state, arm), cell in self.cells.items()
            ],
        }

    def restore(self, posteriors: list[dict]) -> None:
        """Warm-start from an earlier run. A cold table across 15 cells looks like a random
        bot flailing, which is not what learning looks like to anyone watching."""
        for row in posteriors:
            cell = self.cells.get((ChatState(row["state"]), Arm(row["arm"])))
            if cell:
                cell.alpha, cell.beta, cell.pulls = row["alpha"], row["beta"], row["pulls"]

    def _draw(self, state: ChatState, arm: Arm) -> float:
        cell = self.cells[state, arm]
        if cell.pulls < MIN_PULLS:
            return self._rng.betavariate(PRIOR, PRIOR)  # cold-start floor: explore first
        return self._rng.betavariate(cell.alpha, cell.beta)

    def _propensity(self, state: ChatState, arm: Arm) -> float:
        """P(this arm wins) under the current posteriors, by Monte Carlo.

        One extra logged field, and the whole answer to off-policy evaluation later.
        """
        wins = 0
        for _ in range(PROPENSITY_SAMPLES):
            draws = {a: self._draw(state, a) for a in self.arms}
            wins += max(draws, key=draws.__getitem__) == arm
        return wins / PROPENSITY_SAMPLES


# Baselines. They wear the Bandit interface so they are measured through exactly the same
# window, control pool and reward — the comparison is otherwise worthless.


@dataclass
class RandomPolicy:
    """Uniform over arms: the "is the learning doing anything" control."""

    seed: int | None = None
    arms: tuple[Arm, ...] = BANDIT_ARMS
    decisions: int = 0
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def select(self, state: ChatState) -> Decision:
        self.decisions += 1
        return Decision(state, self._rng.choice(self.arms), {}, 1 / len(self.arms))

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        pass

    def snapshot(self) -> dict:
        return {"decisions": self.decisions, "posteriors": []}


@dataclass
class TimerPolicy:
    """A bot without learning. Decisions land roughly a minute apart, so `every=15` is
    about the 15-minute timer every chat has already learned to ignore."""

    arm: Arm = Arm.EMOTE_RALLY
    every: int = 15
    decisions: int = 0

    def select(self, state: ChatState) -> Decision:
        self.decisions += 1
        due = self.decisions % self.every == 0
        return Decision(state, self.arm if due else Arm.NOTHING, {}, 1.0)

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        pass

    def snapshot(self) -> dict:
        return {"decisions": self.decisions, "posteriors": []}


@dataclass
class ReactivePolicy:
    """The rule-based bot everyone builds first: see a lull, say something.

    Also the one policy whose assignment depends on the moment rather than only on state
    and a coin flip, so it is where the naive pre/post estimator's mean-reversion bias
    actually shows up. Kept as a baseline for exactly that reason.
    """

    arm: Arm = Arm.EMOTE_RALLY
    decisions: int = 0

    def select(self, state: ChatState) -> Decision:
        self.decisions += 1
        fire = state is ChatState.LULL
        return Decision(state, self.arm if fire else Arm.NOTHING, {}, 1.0)

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        pass

    def snapshot(self) -> dict:
        return {"decisions": self.decisions, "posteriors": []}


@dataclass
class SilentPolicy:
    """Never intervenes. The floor every other policy has to beat."""

    decisions: int = 0

    def select(self, state: ChatState) -> Decision:
        self.decisions += 1
        return Decision(state, Arm.NOTHING, {}, 1.0)

    def update(self, state: ChatState, arm: Arm, reward: float) -> None:
        pass

    def snapshot(self) -> dict:
        return {"decisions": self.decisions, "posteriors": []}
