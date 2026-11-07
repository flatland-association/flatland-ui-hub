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
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, Any

from app.core.call_log import log_ws
from app.core.session_manager import ensure_policy_enabled, session_manager
from app.core.env_step import step_env
from app.core.dispatcher_driver import playback, broadcast_playback, run_in_worker, interrupted
from app.core.dispatcher import before_step as dispatcher_before_step
from app.core.marey_history import capture_marey_history_snapshot
from app.core.serializer import serialize_env
from app.core.ws_manager import ws_manager
from app.core.play_manager import play_manager, PlayState
from app.policies.override_policy import OverridePolicy
from app.policies.registry import create_runtime_policy
from app.core.override_manager import override_manager

router = APIRouter()


class PlayRequest(BaseModel):
    speed: float = 5.0  # steps per second, 0.5 - 20
    policy: str = "shortest_path"


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
    session = session_manager.get(session_id)
    if session:
        state.update(playback(session))
    if session and session.dispatcher:
        state["dispatcher"] = session.dispatcher.snapshot(session)
        state["active_policy"] = session.policy
    return {"type": "state", "session_id": session_id, "state": state}


_perf_log = logging.getLogger("flatland.perf")
_perf_log.setLevel(logging.INFO)
if not _perf_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    _perf_log.addHandler(_h)


async def _human_play_loop(session_id: str):
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
        default_policy = create_runtime_policy("deadlock_avoidance", env)

    policy = OverridePolicy(default_policy, session_id)
    policy.reset(env)
    policy_revision = session.control_revision

    while state.running:
        step_started = time.perf_counter()
        if _is_done(env):
            state.running = False
            await ws_manager.broadcast(session_id, {
                "type": "episode_done",
                "session_id": session_id,
            })
            log_ws(session_id, "episode_done", step=int(env._elapsed_steps))
            break

        async with session.command_lock:
            try:
                may_step = dispatcher_before_step(session)
                if session.dispatcher and session.dispatcher.run_status == "error":
                    state.running = False
                    await ws_manager.broadcast(session_id, _build_state_payload(session_id, env))
                    break
                if session.dispatcher:
                    selected_policy = session.policy
                    if selected_policy != state.policy or policy_revision != session.control_revision:
                        state.policy = selected_policy
                        policy = OverridePolicy(create_runtime_policy(selected_policy, env), session_id)
                        policy.reset(env)
                        policy_revision = session.control_revision
                handles = env.get_agent_handles()
                observations: dict[int, Any] = session.last_observations or {}
                # Split timing: policy.act_many vs env.step. With heavy policies
                # (DeadLockAvoidance walker) act_many is the dominant cost.
                t_pol0 = time.perf_counter()
                if may_step:
                    policy.start_step()
                    actions = policy.act_many(handles, observations)
                t_pol_ms = (time.perf_counter() - t_pol0) * 1000

                # Pause-responsiveness: re-check state.running between heavy
                # policy compute and env.step. If user pressed Pause while
                # act_many was running, abort BEFORE we apply actions.
                if not state.running:
                    if may_step:
                        policy.end_step()
                    break

                t_env0 = time.perf_counter()
                # Same helper as the /step endpoint (scripted disturbances
                # included), so Play and single-stepping produce the same episode.
                if may_step:
                    next_obs, rewards, dones, info = step_env(session_id, session, actions, policy=policy, policy_id=state.policy)
                t_env_ms = (time.perf_counter() - t_env0) * 1000
                if may_step:
                    policy.end_step()
                # Marey real-history snapshot after websocket/play step.
                capture_marey_history_snapshot(session)
            except Exception as e:
                if session.dispatcher:
                    session.dispatcher.invalidate(session, "run_error")
                    session.dispatcher.status = "error"
                    session.dispatcher.run_status = "error"
                    session.dispatcher.abort_reason = str(e)
                state.running = False
                if session.dispatcher:
                    await ws_manager.broadcast(session_id, _build_state_payload(session_id, env))
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

        # Wait based on configured speed (steps per second)
        delay = max(0.0, 1.0 / max(state.speed, 0.1) - (time.perf_counter() - step_started))
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            break


def _dispatcher_pulse(session, state, policy, revision):
    """One sequential pulse; synchronous model work runs away from ASGI."""
    if not state.running or interrupted(session):
        return policy, revision
    may_step = dispatcher_before_step(session)
    if session.dispatcher.run_status == "error":
        state.running = False
        return policy, revision
    if not may_step or not state.running or interrupted(session):
        return policy, revision
    selected = session.policy
    if policy is None or selected != state.policy or revision != session.control_revision:
        state.policy = selected
        policy = OverridePolicy(create_runtime_policy(selected, session.env), session.id)
        policy.reset(session.env)
        revision = session.control_revision
    policy.start_step()
    try:
        actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
        if state.running and not interrupted(session):
            step_env(session.id, session, actions, policy=policy, policy_id=state.policy)
            capture_marey_history_snapshot(session)
    finally:
        policy.end_step()
    return policy, revision


async def _dispatcher_play_loop(session_id: str):
    state = play_manager.get(session_id)
    session = session_manager.get(session_id)
    if state is None or session is None:
        return
    policy, revision = None, None
    try:
        while state.running:
            started = time.perf_counter()
            async with session.command_lock:
                if not state.running:
                    break
                if _is_done(session.env):
                    state.running = False
                    break
                policy, revision = await run_in_worker(
                    session, lambda: _dispatcher_pulse(session, state, policy, revision))
                if _is_done(session.env):
                    state.running = False
                await ws_manager.broadcast(session_id, _build_state_payload(session_id, session.env))
            if not state.running:
                break
            delay = max(0.0, 1 / max(state.speed, 0.1) - (time.perf_counter() - started))
            await asyncio.sleep(delay)
    except asyncio.CancelledError:
        # run_in_worker already drained before command_lock can be released.
        raise
    except Exception as exc:
        runtime = session.dispatcher
        if runtime.run_status not in {"aborted", "error", "finished"}:
            runtime.invalidate(session, "run_error")
            runtime.status = runtime.run_status = "error"
            runtime.abort_reason = str(exc)
        state.running = False
        await ws_manager.broadcast(session_id, _build_state_payload(session_id, session.env))
        await ws_manager.broadcast(session_id, {"type": "error", "session_id": session_id, "message": str(exc)})
        log_ws(session_id, "error", message=str(exc))
    finally:
        state.running = False
        await broadcast_playback(session)
        if _is_done(session.env):
            await ws_manager.broadcast(session_id, {"type": "episode_done", "session_id": session_id})


async def _play_loop(session_id: str):
    session = session_manager.get(session_id)
    if session and session.dispatcher:
        await _dispatcher_play_loop(session_id)
    else:
        await _human_play_loop(session_id)


@router.websocket("/ws/session/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    session = session_manager.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return

    await ws_manager.connect(session_id, websocket)
    log_ws(session_id, "connect")
    try:
        # Live telemetry stays available while a model call holds the command lock.
        await websocket.send_json({"type": "play_status", "session_id": session_id, **playback(session)})
        if session.dispatcher:
            async with session.command_lock:
                await websocket.send_json(_build_state_payload(session_id, session.env))
        else:
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

    if session.dispatcher and (session.dispatcher.run_status == "error" or (
            session.dispatcher.owner == "synthetic" and session.dispatcher.run_status in {"aborted", "finished"})):
        raise HTTPException(409, "This dispatcher run is terminal; start a new run")

    # Gate on the control-policy set (like /step and /policy): play drives
    # the live session, so any control-enabled policy is playable even if
    # it cannot power scenario forecasts (e.g. goal_directed).
    if not ensure_policy_enabled(session, req.policy):
        raise HTTPException(400, f"Policy '{req.policy}' is not enabled for this session")

    if play_manager.is_playing(session_id):
        # Play while playing retunes the running loop (the tempo slider), it
        # does not start a second one.
        state = play_manager.get(session_id)
        state.speed = req.speed
        return {"session_id": session_id, **playback(session), "speed": req.speed,
                "message": "Already playing"}

    if session.dispatcher:
        session.dispatcher.status = ("planned" if session.dispatcher.pending else "waiting") if session.dispatcher.owner == "synthetic" else "human_control"
    state = PlayState(session_id, req.speed, session.policy if session.dispatcher else req.policy)
    state.running = True
    play_manager.register(state)
    state.task = asyncio.create_task(_play_loop(session_id))
    await broadcast_playback(session)

    return {
        "session_id": session_id,
        **playback(session),
        "speed": req.speed,
        "policy": req.policy,
    }


@router.post("/session/{session_id}/pause")
async def pause(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")

    await play_manager.stop(session_id)
    if session.dispatcher and session.dispatcher.owner == "synthetic":
        session.dispatcher.status = "paused"
        session.dispatcher.event(session, "paused", source="human")
    # A paused leg may be the last one played: put its trajectory on disk now.
    from app.core.trajectory_recorder import persist_trajectory

    persist_trajectory(session)
    await broadcast_playback(session)
    if session.dispatcher:
        await ws_manager.broadcast(session_id, _build_state_payload(session_id, session.env))
    return {"session_id": session_id, **playback(session)}


@router.get("/session/{session_id}/play_status")
def play_status(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")
    return {"session_id": session_id, **playback(session)}
