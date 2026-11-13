"""
WebSocket + Play API Endpoints.

WebSocket: /ws/session/{session_id}
   Client connectet sich, Backend pusht initialen State und nach jedem Step.

Play / Pause:
   POST /session/{session_id}/play  body={speed: 5, policy: "shortest_path"}
   POST /session/{session_id}/pause
"""
import asyncio
import logging
import time
from contextlib import nullcontext
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from typing import Optional, Any

from app.core.call_log import log_ws
from app.core.session_manager import session_manager
from app.core.env_step import step_env
from app.core.marey_history import capture_marey_history_snapshot
from app.core.serializer import serialize_env
from app.core.ws_manager import ws_manager
from app.core.play_manager import play_manager, PlayState
from app.core.pf_ch_control import command_lock, preflight_policy, run_inference, broadcast_playback, is_specialist_policy
from app.policies.learned import pf_ch_bundle, uc2_bundle
from app.policies.override_policy import OverridePolicy
from app.policies.registry import create_runtime_policy
from app.core.override_manager import override_manager

router = APIRouter()


class PlayRequest(BaseModel):
    # Steps per second. No floor beyond > 0: an experiment scenario may run a
    # step every minute (docs/plans/experiment-scenario-import.md §3.8).
    speed: float = Field(5.0, gt=0)
    policy: str = "shortest_path"


# Longest stretch the play loop sleeps before looking at the speed again.
_WAIT_SLICE_S = 0.1


async def _wait_for_next_step(state) -> None:
    """Wait one step at the current speed. Slept in slices against
    `state.speed`, so a slider change during a long step applies at once
    rather than after it; returns early when the loop is stopped."""
    started = time.monotonic()
    while state.running:
        remaining = 1.0 / state.speed - (time.monotonic() - started)
        if remaining <= 0:
            return
        await asyncio.sleep(min(remaining, _WAIT_SLICE_S))


def _is_done(env) -> bool:
    try:
        if env._elapsed_steps >= env._max_episode_steps:
            return True
    except Exception:
        pass
    try:
        return all(getattr(a.state, "name", str(a.state)) == "DONE" for a in env.agents)
    except Exception:
        return False


def _build_state_payload(session_id: str, env) -> dict:
    """Build the state payload broadcast over WebSocket.
    Includes the current overrides so the frontend keeps showing the
    selected action pills while play is running."""
    overrides = override_manager.get_all(session_id)
    state = serialize_env(env, overrides=overrides)
    state["episode_done"] = _is_done(env)
    return {"type": "state", "session_id": session_id, "state": state}


_perf_log = logging.getLogger("flatland.perf")
_perf_log.setLevel(logging.INFO)
if not _perf_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    _perf_log.addHandler(_h)


async def _play_loop(session_id: str):
    state = play_manager.get(session_id)
    if state is None:
        return
    session = session_manager.get(session_id)
    if session is None:
        return

    env = session.env

    try:
        default_policy = create_runtime_policy(state.policy, env)
    except KeyError:
        if is_specialist_policy(state.policy):
            state.running = False
            await ws_manager.broadcast(session_id, {"type": "error", "session_id": session_id,
                                                    "message": "The selected RL policy is unavailable"})
            return
        default_policy = create_runtime_policy("deadlock_avoidance", env)

    policy = OverridePolicy(default_policy, session_id)
    policy.reset(env)

    while state.running:
        if _is_done(env):
            state.running = False
            await ws_manager.broadcast(session_id, {
                "type": "episode_done",
                "session_id": session_id,
            })
            log_ws(session_id, "episode_done", step=int(env._elapsed_steps))
            break

        async with (command_lock(session) if is_specialist_policy(state.policy) else nullcontext()):
            if not state.running:
                break
            try:
                handles = env.get_agent_handles()
                observations: dict[int, Any] = session.last_observations or {}
                # Split timing: policy.act_many vs env.step. With heavy policies
                # (DeadLockAvoidance walker) act_many is the dominant cost.
                t_pol0 = time.perf_counter()
                policy.start_step()
                if is_specialist_policy(state.policy):
                    try:
                        prepared = policy.default_policy.prepare_inference(handles)
                        proposals = await run_inference(
                            session, lambda: policy.default_policy.infer_prepared(prepared))
                        if state.running:
                            actions = policy.apply_overrides(handles, proposals)
                    except asyncio.CancelledError:
                        policy.end_step()
                        raise
                else:
                    actions = policy.act_many(handles, observations)
                t_pol_ms = (time.perf_counter() - t_pol0) * 1000

                # Pause-responsiveness: re-check state.running between heavy
                # policy compute and env.step. If user pressed Pause while
                # act_many was running, abort BEFORE we apply actions.
                if not state.running:
                    policy.end_step()
                    break

                t_env0 = time.perf_counter()
                # Same helper as the /step endpoint (scripted disturbances
                # included), so Play and single-stepping produce the same episode.
                next_obs, rewards, dones, info = step_env(session_id, session, actions, policy=policy, policy_id=state.policy)
                t_env_ms = (time.perf_counter() - t_env0) * 1000
                policy.end_step()
                # Marey real-history snapshot after websocket/play step.
                capture_marey_history_snapshot(session)
            except Exception as e:
                state.running = False
                await ws_manager.broadcast(session_id, {
                    "type": "error",
                    "session_id": session_id,
                    "message": str(e),
                })
                log_ws(session_id, "error", message=str(e))
                break

        # Skip serialize+broadcast if pause came in during env.step.
        if not state.running:
            break

        t_ser0 = time.perf_counter()
        payload = _build_state_payload(session_id, env)
        t_ser_ms = (time.perf_counter() - t_ser0) * 1000

        t_bcast0 = time.perf_counter()
        await ws_manager.broadcast(session_id, payload)
        t_bcast_ms = (time.perf_counter() - t_bcast0) * 1000

        n_agents = len(handles)
        elapsed = int(env._elapsed_steps)
        policy_id = state.policy
        _perf_log.info(
            f"[PLAY] elapsed={elapsed} agents={n_agents} policy={policy_id} "
            f"act_many={t_pol_ms:.1f}ms env_step={t_env_ms:.1f}ms "
            f"serialize={t_ser_ms:.1f}ms broadcast={t_bcast_ms:.1f}ms"
        )

        try:
            await _wait_for_next_step(state)
        except asyncio.CancelledError:
            break


@router.websocket("/ws/session/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    session = session_manager.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return

    await ws_manager.connect(session_id, websocket)
    log_ws(session_id, "connect")
    try:
        # Send initial state
        await websocket.send_json(_build_state_payload(session_id, session.env))

        # Keep connection alive, just receive any pings
        while True:
            try:
                msg = await websocket.receive_text()
                # Allow client to send commands like "ping"
                if msg == "ping":
                    await websocket.send_json({"type": "pong"})
            except WebSocketDisconnect:
                break
    except Exception:
        pass
    finally:
        ws_manager.disconnect(session_id, websocket)
        log_ws(session_id, "disconnect")


@router.post("/session/{session_id}/play")
async def play(session_id: str, req: PlayRequest):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")

    # Gate on the control-policy set (like /step and /policy): play drives
    # the live session, so any control-enabled policy is playable even if
    # it cannot power scenario forecasts (e.g. goal_directed).
    enabled = set(getattr(session, "enabled_policy_ids", set()))
    if req.policy not in enabled:
        raise HTTPException(400, f"Policy '{req.policy}' is not enabled for this session")

    preflight_policy(session.env, req.policy)
    previous = play_manager.get(session_id)
    pf_ch_switch = (previous is not None and previous.policy != req.policy
                    and any(is_specialist_policy(policy) for policy in (previous.policy, req.policy)))
    if pf_ch_switch:
        await play_manager.stop(session_id)
    if any(is_specialist_policy(policy) for policy in (req.policy, session.policy, getattr(previous, "policy", None))):
        effective = previous.policy if previous and play_manager.is_playing(session_id) else req.policy
        if session.policy != effective or pf_ch_switch:
            from app.api.sessions import _invalidate_scenario_forecasts
            session.policy = effective
            _invalidate_scenario_forecasts(session_id)

    if play_manager.is_playing(session_id):
        # Play while playing retunes the running loop (the tempo slider), it
        # does not start a second one.
        state = play_manager.get(session_id)
        state.speed = req.speed
        return {"session_id": session_id, "playing": True, "speed": req.speed,
                "message": "Already playing"}

    state = PlayState(session_id, req.speed, req.policy)
    state.running = True
    play_manager.register(state)
    state.task = asyncio.create_task(_play_loop(session_id))
    if is_specialist_policy(req.policy):
        await broadcast_playback(session)

    return {
        "session_id": session_id,
        "playing": True,
        "speed": req.speed,
        "policy": req.policy,
    }


@router.post("/session/{session_id}/pause")
async def pause(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")

    await play_manager.stop(session_id)
    # A paused leg may be the last one played: put its trajectory on disk now.
    from app.core.trajectory_recorder import persist_trajectory

    persist_trajectory(session)
    if is_specialist_policy(session.policy):
        await broadcast_playback(session)
    return {"session_id": session_id, "playing": False}


@router.get("/session/{session_id}/play_status")
def play_status(session_id: str):
    return {
        "session_id": session_id,
        "playing": play_manager.is_playing(session_id),
    }
