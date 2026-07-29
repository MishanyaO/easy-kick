"""Builds `data/eval_results.json` for the dashboard charts. Pure stdlib.

    uv run python -m easy_kick.eval.run_eval --worlds 12

Four artefacts, and each one claims only what §9 of the spec says it can:

1. head_to_head  — one seed, two policies. Mechanism, not magnitude.
2. estimators    — estimated lift against the twin-world truth. A named bias going away.
3. policies      — four policies over sampled worlds, in chatters rather than regret.
4. learned       — the posterior table, and what it means in sentences.
"""

import argparse
import json
import math
import statistics
from pathlib import Path

from ..config import PROJECT_ROOT
from ..controller import insights
from ..gym import POLICIES, build_policy, simulate
from ..models import BANDIT_ARMS

OUTPUT = PROJECT_ROOT / "data" / "eval_results.json"
SCHEMA_VERSION = 2


def head_to_head(seed: int, decisions: int) -> dict:
    """Fork at t=0: same seed, same personas, same arc, one policy each."""
    return {name: simulate(seed=seed, decisions=decisions, policy=name)["samples"]
            for name in ("gambit", "timer")}


def estimators(seed: int, decisions: int) -> dict:
    """Both control estimators against ground truth, one point per decision.

    Read this before quoting it. In this gym the two estimators come out close, and that is
    the finding, not a failure: `naive` is only badly biased when firing is *triggered* by a
    dip, and our assignment depends on the chat state plus a coin flip — never on the moment
    within that state. Which is §2's identification argument showing up in the numbers.

    `matched` still earns its place. It is the estimator that stays honest if the policy ever
    becomes dip-triggered, and it costs one subtraction. Compare against the `reactive`
    baseline to see the other half: a bot that fires on every lull never leaves a clean
    window in that state, so it has no control group at all. The bandit builds its own.
    """
    run = simulate(seed=seed, decisions=decisions, policy="gambit", truth=True)
    points = [{"true": r["lift_true"], "matched": r["engagement_delta"],
               "naive": r["lift_naive"], "arm": r["arm"], "state": r["state"]}
              for r in run["results"] if r["lift_true"] is not None]
    fires = [p for p in points if p["arm"] != "nothing"]
    return {
        "points": points,
        "slopes": _fit(fires),
        "by_state": {state: _fit([p for p in fires if p["state"] == state])
                     for state in ("lull", "steady", "spike")},
    }


def _fit(points: list[dict]) -> dict:
    """Slope and mean error of each estimator against the twin-world truth."""
    truth = [p["true"] for p in points]
    return {
        "n": len(points),
        **{name: {"slope": _slope(truth, [p[name] for p in points]),
                  "mean_error": statistics.fmean([p[name] - p["true"] for p in points])
                  if points else 0.0}
           for name in ("matched", "naive")},
    }


def policy_comparison(worlds: int, decisions: int) -> dict:
    """Mean ± 95% CI over sampled worlds. Reported as active chatters per minute — higher
    is better, and it is a number a streamer can picture."""
    out = {}
    for name in POLICIES:
        scores = [simulate(seed=seed, decisions=decisions, policy=name)
                  ["active_chatters_per_min"] for seed in range(worlds)]
        out[name] = {"mean": statistics.fmean(scores), "ci95": _ci95(scores), "n": len(scores)}
    return out


def learned(seed: int, decisions: int) -> dict:
    """The 5×3 table the heatmap draws, plus the sentences that go on the slide."""
    run = simulate(seed=seed, decisions=decisions, policy="gambit")
    brain = build_policy("gambit", seed)
    brain.restore(run["posteriors"])
    return {"posteriors": run["posteriors"], "insights": insights(brain)}


def _slope(xs: list[float], ys: list[float]) -> float:
    """Least-squares slope of y on x. 1.0 would mean the estimator tracks truth exactly."""
    if len(xs) < 2:
        return 0.0
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    denominator = sum((x - mx) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denominator


def _ci95(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return 1.96 * statistics.stdev(values) / math.sqrt(len(values))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worlds", type=int, default=12, help="sampled worlds per policy")
    parser.add_argument("--decisions", type=int, default=80, help="decisions per world")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=str(OUTPUT))
    args = parser.parse_args()

    results = {
        "config": {
            **vars(args),
            "schema_version": SCHEMA_VERSION,
            "arms": [arm.value for arm in BANDIT_ARMS],
        },
        "head_to_head": head_to_head(args.seed, args.decisions),
        "estimators": estimators(args.seed, args.decisions),
        "policies": policy_comparison(args.worlds, args.decisions),
        "learned": learned(args.seed, args.decisions),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"wrote {args.out}")
    for line in results["learned"]["insights"]:
        print(f"  {line}")


if __name__ == "__main__":
    main()
