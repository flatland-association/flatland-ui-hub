"""Session deletion releases retained simulation and forecast payloads.

These regressions exercise the real DELETE endpoint and SessionManager without
building rail infrastructure or running forecast/planning workloads. Weak
references check reachability rather than platform-dependent RSS thresholds.
"""
from __future__ import annotations

import gc
from types import SimpleNamespace
import weakref

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api import sessions
from app.core.contention_cache import contention_cache
from app.core.notification_manager import notification_manager
from app.core.override_manager import override_manager
from app.core.scenario_builder import Scenario
from app.core.scenario_cache import scenario_cache
from app.core.scenario_runner import BranchResult
from app.core.session_manager import session_manager

pytestmark = pytest.mark.integration


class _Environment:
    def __init__(self):
        # Native envs own graphs/builders that can form cycles. Exercise that
        # lifetime without allocating a real Flatland environment.
        self.owner = self


class _Snapshots(list):
    """A weak-referenceable version of the ordinary retained snapshot list."""


class _Recorder:
    def __init__(self, sid, closed):
        self.sid = sid
        self.closed = closed

    def close(self):
        self.closed.append(self.sid)


@pytest.fixture
def client(monkeypatch):
    # Use fresh stores so this test neither deletes another test's sessions
    # nor leaves its own cache values in a module-level singleton.
    monkeypatch.setattr(session_manager, "_sessions", {})
    monkeypatch.setattr(scenario_cache, "_cache", {})
    monkeypatch.setattr(contention_cache, "_cache", {})
    monkeypatch.setattr(sessions, "_STRATEGY_CACHE", {})
    monkeypatch.setattr(override_manager, "_overrides", {})
    monkeypatch.setattr(notification_manager, "_events", {})
    app = FastAPI()
    app.include_router(sessions.router, prefix="/session")
    with TestClient(app) as test_client:
        yield test_client


def _retained_session(sid, closed):
    env = _Environment()
    snapshots = _Snapshots([
        {"step": 0, "agents": {"0": {"pos": [1, 1], "dir": 1, "state": "STOPPED"}}},
    ])
    session = SimpleNamespace(
        id=sid,
        env=env,
        trajectory=_Recorder(sid, closed),
        marey_history_snapshots=snapshots,
        sandbox_checkpoints=[{"env": env}],
    )
    session_manager._sessions[sid] = session
    forecast = Scenario(
        name="retained forecast", policy_id="deadlock_avoidance",
        result=BranchResult(snapshots=snapshots),
    )
    scenario_cache.put_full(sid, "0:overrides:kpis", [forecast], [{"snapshots": snapshots}])
    contention_cache.put(sid, 0, [{"id": "contention"}])
    sessions._STRATEGY_CACHE[sid] = ("key", {"strategies": [{"snapshots": snapshots}]})
    override_manager.set(sid, 0, 4)
    notification_manager.add(
        sid, kind="info", title="test", message="retained event", timestamp=0,
    )
    return weakref.ref(env), weakref.ref(snapshots)


def test_delete_releases_environment_and_forecasts_but_preserves_other_session(client):
    closed = []
    env_ref, snapshots_ref = _retained_session("deleted", closed)
    other_env_ref, other_snapshots_ref = _retained_session("other", closed)

    response = client.delete("/session/deleted")

    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": "deleted"}
    assert closed == ["deleted"]  # trajectory persistence still runs on delete
    assert session_manager.get("deleted") is None
    assert scenario_cache.get_scenarios("deleted", "0:overrides:kpis") is None
    assert contention_cache.get("deleted", 0) is None
    assert "deleted" not in sessions._STRATEGY_CACHE
    assert "deleted" not in override_manager._overrides
    assert "deleted" not in notification_manager._events
    gc.collect()
    assert env_ref() is None
    assert snapshots_ref() is None

    # A cleanup for one participant must not evict another participant's data.
    assert session_manager.get("other").env is other_env_ref()
    assert scenario_cache.get_scenarios("other", "0:overrides:kpis") is not None
    assert other_snapshots_ref() is not None
    assert contention_cache.get("other", 0) is not None
    assert "other" in sessions._STRATEGY_CACHE
    assert override_manager.get("other", 0) == 4
    assert "other" in notification_manager._events


def test_repeated_session_deletion_leaves_no_retained_forecast_history(client):
    closed = []
    references = []
    for index in range(8):
        sid = f"completed-{index}"
        references.extend(_retained_session(sid, closed))
        response = client.delete(f"/session/{sid}")
        assert response.status_code == 200, response.text

    gc.collect()
    assert len(closed) == 8
    assert all(reference() is None for reference in references)
    assert session_manager.list_ids() == []
    assert scenario_cache._cache == {}
    assert contention_cache._cache == {}
    assert sessions._STRATEGY_CACHE == {}
    assert override_manager._overrides == {}
    assert notification_manager._events == {}


def test_delete_releases_director_player_backreference_and_preserves_other_env(client, monkeypatch):
    """A weak key alone cannot free an env strongly owned by its cached player."""
    from app.policies import goal_directed_policy as director
    from app.policies.goal_based_policies.schedule import SchedulePlayer

    names = ("_PLAYERS", "_PLAN_INFO", "_ENV_WEIGHTS", "_SCHEDULES",
             "_RESET_GEN", "_UNROUTABLE", "_REPLAN_STATE")
    for name in names:
        monkeypatch.setattr(director, name, weakref.WeakKeyDictionary())
    closed = []
    deleted_ref, _ = _retained_session("deleted", closed)
    other_ref, _ = _retained_session("other", closed)
    deleted_env, other_env = deleted_ref(), other_ref()
    for env in (deleted_env, other_env):
        # The real player constructor needs no rail operations for an empty
        # schedule, and its strong .env is the retention bug being exercised.
        director._PLAYERS[env] = SchedulePlayer(None, env)
        for name in names[1:]:
            getattr(director, name)[env] = {"retained": True}
    del env, deleted_env

    response = client.delete("/session/deleted")

    assert response.status_code == 200, response.text
    gc.collect()
    assert deleted_ref() is None
    assert director._PLAYERS[other_env].env is other_env
    for name in names:
        cache = getattr(director, name)
        assert len(cache) == 1
        assert other_env in cache
    assert closed == ["deleted"]


@pytest.mark.parametrize("full", [False, True])
def test_late_forecast_cannot_repopulate_deleted_session_cache(client, full):
    """A request worker can finish after the UI has deleted its old session."""
    closed = []
    _retained_session("deleted", closed)
    assert client.delete("/session/deleted").status_code == 200
    snapshots = _Snapshots([{"step": 10, "agents": {}}])
    snapshots_ref = weakref.ref(snapshots)
    forecast = Scenario(
        name="late forecast", policy_id="deadlock_avoidance",
        result=BranchResult(snapshots=snapshots),
    )
    options = [{"snapshots": snapshots}]

    if full:
        scenario_cache.put_full("deleted", "late", [forecast], options)
    else:
        scenario_cache.put("deleted", "late", options)

    assert scenario_cache.get("deleted", "late") is None
    assert scenario_cache.get_scenarios("deleted", "late") is None
    del forecast, options, snapshots
    gc.collect()
    assert snapshots_ref() is None
