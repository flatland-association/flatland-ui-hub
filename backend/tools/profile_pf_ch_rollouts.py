"""Fresh-process actual API play/delete cycles; no UI/forecasts or training."""

import argparse
import gc
import json
import os
import platform
import resource
import subprocess
import sys
import time
import weakref
from pathlib import Path


def main():
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ["STUDY_TRAJECTORIES_ENABLED"] = "0"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episodes", type=int, default=10)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.episodes < 2:
        parser.error("--episodes must be at least 2")

    def rss():
        if sys.platform.startswith("linux"):
            for line in Path("/proc/self/status").read_text().splitlines():
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
        return int(subprocess.check_output(["/bin/ps", "-o", "rss=", "-p", str(os.getpid())], text=True).strip()) * 1024

    report = {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "rss_unit": "bytes",
        "scope": f"Cold app import, then {args.episodes} real API Play episodes with four faults; no browser or HMI forecasts. One ASGI process, CPU, OMP/BLAS=1. Current RSS via ps; peak via resource.",
        "initial_rss": rss(),
        "episodes": [],
    }
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.session_manager import session_manager
    from app.core.stops import served_stops
    from app.core.scenario_cache import scenario_cache
    from app.core.play_manager import play_manager

    report["app_import_rss"] = rss()
    report["torch_loaded_at_app_import"] = "torch" in sys.modules
    from importlib.metadata import version

    report["flatland_version"] = version("flatland-rl")
    report["torch_version"] = version("torch")
    from flatland.envs.step_utils.states import TrainState

    with TestClient(app) as client:
        env_refs = []
        for iteration in range(args.episodes):
            start = time.perf_counter()
            response = client.post(
                "/session",
                json={
                    "scenario_preset_id": "pf-ch-corridor-stops",
                    "max_episode_steps": 320,
                    "disturbance_ids": ["corridor-shift-incidents"],
                },
            )
            assert response.status_code == 200, response.text
            sid = response.json()["id"]
            session = session_manager.get(sid)
            ref = weakref.ref(session)
            env_refs.append(weakref.ref(session.env))
            assert session.env._max_episode_steps == 320
            before = rss()
            response = client.post(f"/session/{sid}/policy", json={"policy": "pf_ch_rl"})
            assert response.status_code == 200, response.text
            loaded = rss()
            frames = 0
            with client.websocket_connect(f"/ws/session/{sid}") as ws:
                response = client.post(f"/session/{sid}/play", json={"policy": "pf_ch_rl", "speed": 1000})
                assert response.status_code == 200, response.text
                while True:
                    msg = ws.receive_json()
                    frames += 1
                    assert msg["type"] != "error", msg
                    if msg["type"] == "episode_done" or (
                        msg["type"] == "state" and msg.get("state", {}).get("episode_done")
                    ):
                        break
            arrived = sum(a.state == TrainState.DONE for a in session.env.agents)
            stops = sum(len(served_stops(session.env, h)) for h in session.env.get_agent_handles())
            finish = int(session.env._elapsed_steps)
            faults = len(session.disturbance_scheduler._fired)
            assert (arrived, stops, finish, faults) == (16, 48, 197, 4), (arrived, stops, finish, faults)
            assert session.policy == "pf_ch_rl"
            response = client.delete(f"/session/{sid}")
            assert response.status_code == 200, response.text
            del session
            gc.collect()
            assert ref() is None, "Session retained after delete"
            assert session_manager.list_ids() == []
            assert play_manager.get(sid) is None
            assert not any(k[0] == sid for k in scenario_cache._cache)
            row = {
                "iteration": iteration + 1,
                "arrived": arrived,
                "required_stops_served": stops,
                "finish_step": finish,
                "faults": faults,
                "ws_frames": frames,
                "seconds": round(time.perf_counter() - start, 3),
                "after_create_rss": before,
                "after_selection_rss": loaded,
                "after_delete_gc_rss": rss(),
                "session_collected": ref() is None,
            }
            report["episodes"].append(row)
            print(json.dumps(row), flush=True)
    from app.policies.learned.learned_ppo_policy import _MODELS

    report["cached_models"] = len(_MODELS)
    report["remaining_sessions"] = len(session_manager.list_ids())
    report["envs_still_alive_after_gc"] = [r() is not None for r in env_refs]
    # The native shared default GlobalObs builder can hold the latest created env.
    # That bounded reference must not keep earlier rollouts alive.
    assert not any(r() is not None for r in env_refs[:-1]), "Earlier env retained"
    report["peak_rss"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    report["rss_delta_after_cycle_2"] = (
        report["episodes"][-1]["after_delete_gc_rss"] - report["episodes"][1]["after_delete_gc_rss"]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "episodes"}), flush=True)


if __name__ == "__main__":
    main()
