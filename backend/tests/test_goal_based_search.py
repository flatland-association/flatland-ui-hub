"""The greedy Director search: determinism, trace, portfolio guarantee."""
import json
import warnings

warnings.filterwarnings("ignore")

import pytest  # noqa: E402

from app.policies.goal_based_policies.dataset import (  # noqa: E402
    Layout,
    build_layout_env,
    plan_all_lines,
)
from app.policies.goal_based_policies.ensemble import (  # noqa: E402
    DirectorWeights,
    ScenarioContext,
)
from app.policies.goal_based_policies.infrastructure_graph import (  # noqa: E402
    build_decision_point_graph,
)
from app.policies.goal_based_policies.search import (  # noqa: E402
    SearchLimits,
    beam_search,
    director_plan,
    greedy_search,
    mcts_search,
    verify_plan,
)


@pytest.fixture(scope="module")
def scenario():
    env = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 4)
    graph = build_decision_point_graph(env)
    assert plan_all_lines(env, graph) is not None
    return env, graph, ScenarioContext.build(env, graph)


@pytest.fixture(scope="module")
def models():
    import torch

    from app.policies.goal_based_policies.connection_model import (
        ConnectionTransformer,
    )
    from app.policies.goal_based_policies.evaluator import ScheduleEvaluator

    torch.manual_seed(0)
    evaluator = ScheduleEvaluator(
        hidden=16, rounds=1, trunk_layers=1, sequence_layers=1)
    connection_model = ConnectionTransformer(
        hidden=16, rounds=1, layers=1, heads=2, dropout=0.0)
    return evaluator, connection_model


@pytest.mark.integration
def test_the_search_is_deterministic(scenario, models):
    """Same scenario, same models, same weights — the trace and the plan
    must repeat exactly, or no experiment downstream is reproducible."""
    env, graph, context = scenario
    weights = DirectorWeights(2.0, 1.0, 1.0)
    first = greedy_search(env, graph, context, weights, *models)
    second = greedy_search(env, graph, context, weights, *models)
    assert json.dumps(first.trace, sort_keys=True) == json.dumps(
        second.trace, sort_keys=True)
    assert [s.to_flat_list() for s in first.schedules] == [
        s.to_flat_list() for s in second.schedules]


@pytest.mark.integration
def test_the_search_finishes_every_train_and_explains_itself(scenario, models):
    env, graph, context = scenario
    outcome = greedy_search(
        env, graph, context, DirectorWeights(), *models)
    assert outcome.stuck == ()
    assert {s.handle for s in outcome.schedules} == {0, 1, 2, 3}
    assert all(len(s.entries) >= 2 for s in outcome.schedules)
    assert outcome.decisions == len(outcome.trace) > 0

    for entry in outcome.trace:
        assert entry["chosen"] in range(len(entry["options"]))
        chosen = entry["options"][entry["chosen"]]
        assert chosen["considered"]
        # The chosen option is the best among the considered ones.
        best = max(
            (o for o in entry["options"] if o["considered"]),
            key=lambda o: o["weighted"],
        )
        assert chosen["weighted"] == pytest.approx(best["weighted"])
    json.dumps(outcome.trace)


def test_decision_budget_caps_the_walk(scenario, models):
    env, graph, context = scenario
    capped = greedy_search(
        env, graph, context, DirectorWeights(), *models,
        limits=SearchLimits(max_decisions=2))
    assert capped.decisions == 2
    assert len(capped.schedules) == 4  # completions still cover everyone


@pytest.mark.integration
def test_the_director_never_returns_worse_than_the_baselines(scenario, models):
    """The portfolio guarantee applies to executable plans: no model
    score may rescue a candidate that fails the actual mission."""
    env, graph, context = scenario
    for weights in (
        DirectorWeights(1, 0, 0),
        DirectorWeights(0, 1, 0),
        DirectorWeights(0, 0, 1),
    ):
        plan = director_plan(
            env, graph, weights, *models, context=context)
        assert plan.source in plan.considered
        assert plan.score.weighted == pytest.approx(
            max(plan.considered.values()))
        assert {"search", "lines", "avoidance"} <= set(plan.validation)
        assert set(plan.considered) == {
            name for name, report in plan.validation.items()
            if report["accepted"]
        }
        payload = json.loads(json.dumps(plan.to_dict()))
        assert payload["source"] == plan.source
        assert set(payload["schedules"]) == {"0", "1", "2", "3"} or set(
            payload["schedules"]) == {0, 1, 2, 3}


@pytest.mark.integration
def test_beam_search_is_deterministic_and_never_below_its_own_pool(scenario, models):
    """Repeat runs must match exactly, every train must be planned, and
    widening the beam must not *lower* the search's own objective — a
    wider beam sees a superset of one-step choices at every step."""
    env, graph, context = scenario
    weights = DirectorWeights(1, 1, 1)
    first = beam_search(env, graph, context, weights, *models,
                        limits=SearchLimits(beam_width=3))
    again = beam_search(env, graph, context, weights, *models,
                        limits=SearchLimits(beam_width=3))
    assert json.dumps(first.trace, sort_keys=True) == json.dumps(
        again.trace, sort_keys=True)
    assert {s.handle for s in first.schedules} == {0, 1, 2, 3}
    assert first.trace  # step-level records exist
    json.dumps(first.trace)

    narrow = beam_search(env, graph, context, weights, *models,
                         limits=SearchLimits(beam_width=1))
    assert first.score.weighted >= narrow.score.weighted - 1e-9


@pytest.mark.integration
def test_mcts_search_is_deterministic_and_reports_visits(scenario, models):
    """No randomness anywhere: repeat runs must be identical. Every root
    decision's trace carries visit counts summing to the simulation
    budget — the training signal for the future policy prior."""
    env, graph, context = scenario
    weights = DirectorWeights(1, 1, 1)
    limits = SearchLimits(simulations=8)
    first = mcts_search(env, graph, context, weights, *models, limits=limits)
    again = mcts_search(env, graph, context, weights, *models, limits=limits)
    assert json.dumps(first.trace, sort_keys=True) == json.dumps(
        again.trace, sort_keys=True)
    assert {s.handle for s in first.schedules} == {0, 1, 2, 3}
    for entry in first.trace:
        visits = sum(o["visits"] for o in entry["options"])
        assert visits == limits.simulations
        chosen = entry["options"][entry["chosen"]]
        assert chosen["considered"]
        assert chosen["visits"] == max(o["visits"] for o in entry["options"])
    json.dumps(first.trace)


@pytest.mark.slow
def test_mcts_accepts_a_learned_prior_and_stays_deterministic(
        scenario, models):
    """The prior redistributes exploration; it must not break determinism
    or the visit accounting, and the result is still a complete plan."""
    import torch

    from app.policies.goal_based_policies.priors import BranchPrior

    env, graph, context = scenario
    torch.manual_seed(3)
    prior = BranchPrior()
    limits = SearchLimits(simulations=6)
    first = mcts_search(env, graph, context, DirectorWeights(), *models,
                        limits=limits, prior=prior)
    again = mcts_search(env, graph, context, DirectorWeights(), *models,
                        limits=limits, prior=prior)
    assert json.dumps(first.trace, sort_keys=True) == json.dumps(
        again.trace, sort_keys=True)
    assert {s.handle for s in first.schedules} == {0, 1, 2, 3}
    for entry in first.trace:
        assert sum(o["visits"] for o in entry["options"]) == limits.simulations


@pytest.mark.integration
def test_director_plan_dispatches_strategies_and_keeps_the_guarantee(
        scenario, models):
    env, graph, context = scenario
    weights = DirectorWeights(1, 1, 1)
    with pytest.raises(ValueError, match="unknown strategy"):
        director_plan(env, graph, weights, *models, context=context,
                      strategy="beem")
    for strategy in ("beam", "mcts"):
        plan = director_plan(
            env, graph, weights, *models, context=context,
            strategy=strategy,
            limits=SearchLimits(beam_width=2, simulations=6),
        )
        assert plan.score.weighted == pytest.approx(
            max(plan.considered.values()))


@pytest.mark.integration
def test_verification_returns_ground_truth_for_the_plan(models):
    """Rollout on a fresh env: the verified numbers exist and are typed;
    their agreement with predictions is the offline sweep's territory."""
    from app.policies.goal_based_policies.stations import resolve_stations

    env = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 4)
    graph = build_decision_point_graph(env)
    context = ScenarioContext.build(env, graph)
    plan = director_plan(
        env, graph, DirectorWeights(), *models, context=context)

    fresh = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 4)
    fresh_graph = build_decision_point_graph(fresh)
    verified = verify_plan(
        fresh, fresh_graph, resolve_stations(fresh), plan.schedules)
    assert set(verified) == {
        "total_delay", "all_arrived", "bucket", "connections_total",
        "connections_kept", "kept_ratio", "safety", "steps",
    }
    assert verified["total_delay"] >= 0
    assert 0.0 <= verified["kept_ratio"] <= 1.0
    assert 0.0 <= verified["safety"] <= 1.0


@pytest.fixture
def admission_portfolio(monkeypatch):
    """Isolate final ranking from neural search and physical validation.

    Validator integration tests execute actual trains. These tests check
    the separate admission boundary: even the most attractive score must
    never let a rejected plan through.
    """
    from types import SimpleNamespace

    from app.planners import director_pp, plan_validation
    from app.policies.goal_based_policies import search
    from app.policies.goal_based_policies.ensemble import CandidateScore
    from app.policies.goal_based_policies.schedule import (
        ScheduleEntry, TrainSchedule,
    )

    plans = {
        name: [TrainSchedule(0, [ScheduleEntry(index)])]
        for index, name in enumerate(("search", "lines", "avoidance", "pp1", "pp2"))
    }
    names = {id(plan): name for name, plan in plans.items()}
    accepted = set()
    scores = {"search": 0.99, "lines": 0.4, "avoidance": 0.2,
              "pp1": 0.3, "pp2": 0.5}
    scored_names, pp_calls = [], []
    pp_plans = []

    def score(name):
        value = scores[name]
        return CandidateScore(value, value, value, value, None,
                              {"utilities": {}})

    monkeypatch.setitem(search.STRATEGIES, "greedy", lambda *a, **kw:
                        search.SearchOutcome(plans["search"], score("search"),
                                             [{"handle": 0, "chosen": 0}], 1, (0,)))
    monkeypatch.setattr(search, "plan_all_lines", lambda *a: plans["lines"])
    monkeypatch.setattr(search, "plan_avoiding_overlaps", lambda *a: plans["avoidance"])

    def validate(env, graph, schedules):
        name = names[id(schedules)]
        ok = name in accepted
        return SimpleNamespace(
            accepted=ok,
            reason="complete" if ok else "mission-incomplete",
            to_dict=lambda: {"accepted": ok,
                             "reason": "complete" if ok else "mission-incomplete"},
        )

    def rank(context, candidates, *args):
        out = []
        for plan in candidates:
            name = names[id(plan)]
            assert name in accepted, "an invalid final plan reached objective ranking"
            scored_names.append(name)
            out.append(score(name))
        return out

    def pp(env, graph):
        pp_calls.append((env, graph))
        return [((0,), plans[name]) for name in pp_plans]

    monkeypatch.setattr(plan_validation, "validate_schedules", validate)
    monkeypatch.setattr(search, "score_candidates", rank)
    monkeypatch.setattr(director_pp, "candidate_schedules", pp)
    return SimpleNamespace(accepted=accepted, scored=scored_names, pp_calls=pp_calls,
                           pp_plans=pp_plans, plans=plans)


def test_final_admission_rejects_a_higher_scoring_unexecutable_plan(admission_portfolio):
    pool = admission_portfolio
    pool.accepted.update(("lines", "avoidance"))
    plan = director_plan(object(), object(), DirectorWeights(), None, None,
                         context=object())
    assert plan.source == "lines"
    assert plan.schedules is pool.plans["lines"]
    assert plan.considered == {"lines": 0.4, "avoidance": 0.2}
    assert plan.validation["search"] == {
        "accepted": False, "reason": "mission-incomplete"}
    assert not pool.pp_calls
    assert set(pool.scored) == {"lines", "avoidance"}
    assert plan.to_dict()["validation"] == plan.validation
    assert plan.trace == []
    assert plan.decisions == 0
    assert plan.stuck == ()


def test_strict_pp_can_supply_a_valid_plan_when_the_native_portfolio_fails(admission_portfolio):
    pool = admission_portfolio
    pool.pp_plans.extend(("pp1", "pp2"))
    pool.accepted.add("pp2")
    plan = director_plan(object(), object(), DirectorWeights(), None, None,
                         context=object())
    assert plan.source == "pp-2"
    assert plan.schedules is pool.plans["pp2"]
    assert plan.considered == {"pp-2": 0.5}
    assert len(pool.pp_calls) == 1
    assert pool.scored == ["pp2"]
    assert not plan.validation["pp"]["accepted"]
    assert plan.validation["pp-2"]["accepted"]
    assert plan.trace == []
    assert plan.decisions == 0
    assert plan.stuck == ()


def test_no_valid_candidate_is_an_explicit_failure_with_rejection_evidence(admission_portfolio):
    from app.policies.goal_based_policies.search import NoExecutablePlanError

    pool = admission_portfolio
    pool.pp_plans.append("pp1")
    with pytest.raises(NoExecutablePlanError, match="No executable") as rejected:
        director_plan(object(), object(), DirectorWeights(), None, None,
                      context=object())
    assert set(rejected.value.reports) == {"search", "lines", "avoidance", "pp"}
    assert all(not report["accepted"] for report in rejected.value.reports.values())
    assert rejected.value.pp_attempted
    assert pool.scored == []


def test_no_representable_pp_result_stays_an_explicit_failure(admission_portfolio):
    from app.policies.goal_based_policies.search import NoExecutablePlanError

    with pytest.raises(NoExecutablePlanError) as rejected:
        director_plan(object(), object(), DirectorWeights(), None, None,
                      context=object())
    assert rejected.value.reports["pp"] == {
        "accepted": False, "reason": "no-representable-pp-plan",
        "stage": "pp-fallback"}


def test_a_large_initial_scene_uses_valid_pp_before_learned_search(
        admission_portfolio, monkeypatch):
    from types import SimpleNamespace

    from app.policies.goal_based_policies import search

    pool = admission_portfolio
    pool.pp_plans.extend(("pp1", "pp2"))
    pool.accepted.update(("pp1", "pp2"))

    def refuse(*args, **kwargs):
        raise AssertionError("ran expensive native search despite a valid PP portfolio")

    monkeypatch.setitem(search.STRATEGIES, "greedy", refuse)
    monkeypatch.setattr(search, "plan_all_lines", refuse)
    env = SimpleNamespace(agents=[object()] * (search.TRAINED_MAX_TRAINS + 1),
                          _elapsed_steps=0)
    plan = director_plan(env, object(), DirectorWeights(), None, None,
                         context=object())
    assert plan.source == "pp-2"
    assert plan.considered == {"pp": 0.3, "pp-2": 0.5}
    assert len(pool.pp_calls) == 1
    assert plan.trace == [] and plan.decisions == 0 and plan.stuck == ()
    assert set(plan.validation) == {"pp", "pp-2"}
    assert all(report["stage"] == "initial-pp" for report in plan.validation.values())


def test_eight_trains_retain_native_construction_before_pp(admission_portfolio):
    from types import SimpleNamespace

    from app.policies.goal_based_policies import search

    pool = admission_portfolio
    pool.pp_plans.append("pp2")
    pool.accepted.update(("search", "pp2"))
    env = SimpleNamespace(agents=[object()] * search.TRAINED_MAX_TRAINS,
                          _elapsed_steps=0)
    plan = director_plan(env, object(), DirectorWeights(), None, None,
                         context=object())
    assert plan.source == "search"
    assert pool.pp_calls == []


def test_failed_large_initial_pp_is_not_repeated_after_native_failure(admission_portfolio):
    from types import SimpleNamespace

    from app.policies.goal_based_policies import search

    pool = admission_portfolio
    pool.pp_plans.append("pp1")
    env = SimpleNamespace(agents=[object()] * (search.TRAINED_MAX_TRAINS + 1),
                          _elapsed_steps=0)
    with pytest.raises(search.NoExecutablePlanError) as rejected:
        director_plan(env, object(), DirectorWeights(), None, None,
                      context=object())
    assert len(pool.pp_calls) == 1
    assert set(rejected.value.reports) == {"pp", "search", "lines", "avoidance"}
    assert rejected.value.reports["pp"]["stage"] == "initial-pp"
    assert rejected.value.pp_attempted


def test_a_native_plan_can_still_succeed_after_large_initial_pp_is_rejected(admission_portfolio):
    from types import SimpleNamespace

    from app.policies.goal_based_policies import search

    pool = admission_portfolio
    pool.pp_plans.append("pp1")
    pool.accepted.add("search")
    env = SimpleNamespace(agents=[object()] * (search.TRAINED_MAX_TRAINS + 1),
                          _elapsed_steps=0)
    plan = director_plan(env, object(), DirectorWeights(), None, None,
                         context=object())
    assert plan.source == "search"
    assert plan.considered == {"search": 0.99}
    assert len(pool.pp_calls) == 1
    assert not plan.validation["pp"]["accepted"]
