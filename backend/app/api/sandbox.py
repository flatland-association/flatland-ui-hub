"""Event Simulation sandbox: play a moment of the shift again, differently.

Step 8 of the Co-Learning flow (thesis Table 1, "Event Simulation"). The
interview tour shows precomputed cards (`scripts/generate_sandbox_outcomes.py`);
this is the playable version for the advanced tour:

- ``POST .../sandbox/checkpoint`` keeps a fork of the episode at the decision
  moment — taken when the conflict surfaces, before anyone decides — together
  with what the impact analysis said about it then.
- ``POST .../sandbox/run`` plays one option from that fork to the end of the
  episode: hold until a chosen step, hold without release, proceed, reroute.
- ``GET .../sandbox`` lists the checkpoints and the run as it was played,
  completed by simulation when the shift was ended early.

Every variant goes through the same branch runner and the same override
semantics as the what-if and the Plan / KI / Mensch courses
(`TrajectoryBranchRunner`, STOP sticky until released, REROUTE a route around
the block), and delay is measured against the plan's arrival steps, as there.

Limits, stated rather than hidden: scripted disturbances due after the
checkpoint are not replayed (the branch runner does not fire them), and a live
run's forks draw no new random breakdowns, like every forecast fork.

Reuse target for a sandbox that restores any moment of the shift:
AI4REALNET/agent-as-a-service-trace-rl (A3S restore / simulate-forward).
Plan: docs/plans/colearning-advanced-tour.md (WP1).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.overrides import _branch_run, _policy_factory_for_session
from app.core.override_manager import override_manager
from app.core.recommenders.registry import active_recommender
from app.core.route_overrides import REROUTE_ACTION, route_around_blocks
from app.core.scenario_runner import TrajectoryBranchRunner
from app.core.session_manager import session_manager
from app.policies.plan_policy import planned_arrival_steps

router = APIRouter()

STOP = 4
#: A tour has one or two decision moments; this only bounds memory.
MAX_CHECKPOINTS = 5


def _session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")
    return session


def _fork(env):
    """A clone of `env` at its current step, through the branch runner's fork,
    so a checkpoint carries routes, served stops and a quiet malfunction
    generator exactly as a what-if fork does."""
    forked = TrajectoryBranchRunner(env, None)._fork_env()
    # Forks of this checkpoint must stay quiet too, which the runner decides by
    # the base env's live seed.
    live_seed = getattr(env, "_live_seed", None)
    if live_seed is not None:
        forked._live_seed = live_seed
    forked._max_episode_steps = getattr(env, "_max_episode_steps", None)
    return forked


def _item_view(env, item: dict) -> dict:
    handle = int(item["handle"])
    blocked_by = item.get("blocked_by")
    return {
        "handle": handle,
        "blocked_by": None if blocked_by is None else int(blocked_by),
        "clears_in_steps": int(item.get("clears_in_steps") or 0),
        "can_reroute": route_around_blocks(env, handle) is not None,
    }


def _arrival_from_env(agent) -> int | None:
    """Arrival step as Flatland stamps it — the same count the branch runner
    records (the step count after the env.step in which the train became DONE)."""
    arrival = getattr(agent, "arrival_time", None)
    return None if arrival is None else int(arrival)


def _outcome(arrivals: dict[int, int | None], plan: dict[int, int], total: int, deadlocks: int) -> dict:
    """The shape of a precomputed sandbox variant (`sandbox-outcomes.ts`), so the
    HMI draws played and precomputed variants the same way."""
    trains = []
    for handle in range(total):
        arrived_at = arrivals.get(handle)
        planned = plan.get(handle)
        trains.append({
            "handle": handle,
            "arrived": arrived_at is not None,
            "arrivalStep": arrived_at,
            "delayVsPlan": None if arrived_at is None or planned is None else arrived_at - planned,
        })
    return {
        "arrived": sum(1 for t in trains if t["arrived"]),
        "total": total,
        "totalDelayVsPlan": sum(t["delayVsPlan"] or 0 for t in trains),
        "deadlocks": int(deadlocks),
        "trains": trains,
    }


def _branch_outcome(base_env, res, plan: dict[int, int]) -> dict:
    """Arrivals of a branch, including the trains already in before the fork."""
    arrivals: dict[int, int | None] = {}
    for agent in base_env.agents:
        arrivals[int(agent.handle)] = _arrival_from_env(agent)
    for handle, o in res.agent_outcomes.items():
        if arrivals.get(int(handle)) is None and o.get("arrival_step") is not None:
            arrivals[int(handle)] = int(o["arrival_step"])
    return _outcome(arrivals, plan, len(base_env.agents), res.kpis.get("deadlocks", 0) or 0)


def _horizon(env) -> int:
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    max_ep = int(getattr(env, "_max_episode_steps", 0) or 0) or 250
    return max(0, max_ep - elapsed)


def _checkpoint_view(cp: dict) -> dict:
    return {"id": cp["id"], "step": cp["step"], "items": cp["items"]}


@router.post("/{session_id}/sandbox/checkpoint")
def take_checkpoint(session_id: str):
    """Keep the episode as it is now, for playing it again after the shift.

    Idempotent per step: a second call at the same step returns the first."""
    session = _session(session_id)
    env = session.env
    step = int(getattr(env, "_elapsed_steps", 0) or 0)
    checkpoints = session.sandbox_checkpoints
    for cp in checkpoints:
        if cp["step"] == step:
            return _checkpoint_view(cp)
    if len(checkpoints) >= MAX_CHECKPOINTS:
        raise HTTPException(409, f"At most {MAX_CHECKPOINTS} checkpoints per session")

    items = [_item_view(env, item) for item in active_recommender().recommend(env)]
    decided = {item["handle"] for item in items}
    # The overrides that stand regardless of this decision — the system hold on
    # the affected train itself is what the sandbox lets the operator replace.
    committed = {
        int(h): int(a) for h, a in override_manager.get_all(session_id).items() if int(h) not in decided
    }
    cp = {
        "id": len(checkpoints),
        "step": step,
        "env": _fork(env),
        "items": items,
        "committed": committed,
    }
    checkpoints.append(cp)
    return _checkpoint_view(cp)


@router.get("/{session_id}/sandbox")
def get_sandbox(session_id: str):
    """The checkpoints and the run as it was played.

    When the shift ended before the episode did, the rest of the played run is
    simulated from where it stopped with the overrides then standing, and
    `played_completed_by_simulation` says so."""
    session = _session(session_id)
    env = session.env
    plan = planned_arrival_steps(env)
    still_running = any(_arrival_from_env(a) is None for a in env.agents) and _horizon(env) > 0
    if still_running:
        committed = dict(override_manager.get_all(session_id))
        res = _branch_run(env, _policy_factory_for_session(session), committed, _horizon(env))
        played = _branch_outcome(env, res, plan)
    else:
        arrivals = {int(a.handle): _arrival_from_env(a) for a in env.agents}
        from app.core.scenario_runner import count_deadlocked_agents

        played = _outcome(arrivals, plan, len(env.agents), count_deadlocked_agents(env))
    return {
        "session_id": session_id,
        "checkpoints": [_checkpoint_view(cp) for cp in session.sandbox_checkpoints],
        "played": played,
        "played_completed_by_simulation": still_running,
        "plan_arrival_steps": {str(h): s for h, s in sorted(plan.items())},
    }


class SandboxRunRequest(BaseModel):
    checkpoint: int
    handle: int
    option: Literal["hold_until", "hold", "proceed", "reroute"]
    #: For `hold_until`: steps after the checkpoint at which the train is released.
    release_after: int | None = None


@router.post("/{session_id}/sandbox/run")
def run_sandbox(session_id: str, req: SandboxRunRequest):
    """Play one option from a checkpoint to the end of the episode. Read-only:
    the session and the checkpoint stay as they are, so any option can be
    played again and compared."""
    session = _session(session_id)
    cp = next((c for c in session.sandbox_checkpoints if c["id"] == req.checkpoint), None)
    if cp is None:
        raise HTTPException(404, f"Checkpoint {req.checkpoint} not found")
    env = cp["env"]
    handle = int(req.handle)
    if handle < 0 or handle >= len(env.agents):
        raise HTTPException(404, f"Agent {handle} not found")

    overrides = dict(cp["committed"])
    release: dict[int, int] = {}
    if req.option == "proceed":
        overrides.pop(handle, None)
    elif req.option == "hold":
        overrides[handle] = STOP
    elif req.option == "hold_until":
        if req.release_after is None or req.release_after < 1:
            raise HTTPException(400, "hold_until needs release_after >= 1")
        overrides[handle] = STOP
        release[handle] = cp["step"] + int(req.release_after)
    else:
        if route_around_blocks(env, handle) is None:
            raise HTTPException(409, f"No reroute is available for train {handle} at this checkpoint")
        overrides[handle] = REROUTE_ACTION

    plan = planned_arrival_steps(session.env)
    res = _branch_run(env, _policy_factory_for_session(session), overrides, _horizon(env), release_at=release)
    return {
        "checkpoint": cp["id"],
        "step": cp["step"],
        "handle": handle,
        "option": req.option,
        "release_step": release.get(handle),
        "outcome": _branch_outcome(env, res, plan),
    }
