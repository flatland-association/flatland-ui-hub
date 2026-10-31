"""Record a live session as a flatland-rl Trajectory
(docs/plans/experiment-logging-frontend-and-replay.md §5.4.2).

The recorder copies the collect sequence of flatland's `PolicyRunner.step`
around our own `env.step` (`app.core.env_step.step_env`), so the play loop,
the overrides and the throttling stay as they are, and the files are the
flatland-association format: `TrajectoryEvaluator`, `Trajectory.load_env`
and `Trajectory.fork` work on them without conversion.

Off unless `STUDY_TRAJECTORIES_ENABLED=1`. Files go to the session's study
folder (`app.core.study_paths.session_dir`), subfolder `trajectory/`. Two
files of our own sit next to flatland's event logs:
`HmiEvents.action_provenance.tsv` (the policy's proposal next to the applied
action) and `HmiEvents.disturbances.tsv` (scripted disturbances).
"""

import json
from pathlib import Path
from typing import Any, Optional

from flatland.envs.persistence import RailEnvPersister
from flatland.envs.step_utils.states import TrainState
from flatland.trajectories.trajectories import SERIALISED_STATE_SUBDIR, Trajectory
from flatland.trajectories.trajectory_snapshot_callbacks import TrajectorySnapshotCallbacks

# Flatland's `persist()` rewrites the four TSVs in full, so it runs every
# PERSIST_EVERY steps, at episode end, on reset and on session delete; a
# server crash loses at most the rows since the last one (the pkl snapshots
# and our own HmiEvents rows are on disk already).
PERSIST_EVERY = 50
PROVENANCE_FILE = "event_logs/HmiEvents.action_provenance.tsv"
DISTURBANCES_FILE = "event_logs/HmiEvents.disturbances.tsv"
PROVENANCE_COLUMNS = ("episode_id", "env_time", "agent_id", "proposed_action", "applied_action", "source")
DISTURBANCE_COLUMNS = ("episode_id", "env_time", "agent_id", "kind", "params")


def _action_value(action: Any) -> Any:
    return getattr(action, "value", action)


class TrajectoryRecorder:
    """One per session; a reset starts a new episode (`ep_id`) in the same folder."""

    def __init__(self, folder: Path, env, meta: dict, snapshot_interval: int):
        self.folder = Path(folder)
        self.snapshot_interval = max(0, int(snapshot_interval))
        self.meta: dict = {**meta, "episodes": [], "policy_changes": []}
        self._policy: Optional[str] = None
        self._start(env)

    # ── Episode lifecycle ───────────────────────────────────────────────────

    def _start(self, env) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        # Not `Trajectory.create_empty`: it insists on an empty folder, and a
        # reset's episode shares the session's TSVs with the earlier ones.
        trajectory = Trajectory.load_existing(data_dir=self.folder, ep_id=Trajectory(data_dir=self.folder).ep_id)
        (self.folder / SERIALISED_STATE_SUBDIR).mkdir(parents=True, exist_ok=True)
        RailEnvPersister.save(env, str(self.folder / SERIALISED_STATE_SUBDIR / f"{trajectory.ep_id}.pkl"))
        self.trajectory = trajectory
        self.snapshots = TrajectorySnapshotCallbacks(trajectory, data_dir_override=self.folder, snapshot_interval=self.snapshot_interval)
        self._max_steps = getattr(env, "_max_episode_steps", None)
        self._since_persist = 0
        self._done = False
        self.meta["episodes"].append({"ep_id": trajectory.ep_id, "start_step": int(env._elapsed_steps)})
        self._write_meta()

    def on_reset(self, env) -> None:
        """The session was reset: close this episode, start the next one."""
        self.persist()
        self._start(env)

    def close(self) -> None:
        self.persist()

    # ── Around env.step ─────────────────────────────────────────────────────

    def before_step(self, env, applied: dict, proposed: Optional[dict] = None, sources: Optional[dict] = None, policy: Optional[str] = None) -> None:
        t = int(env._elapsed_steps)
        if policy is not None and policy != self._policy:
            self._policy = policy
            self.meta["policy_changes"].append({"ep_id": self.trajectory.ep_id, "env_time": t, "policy": policy})
            self._write_meta()
        # A change outside env.step (the episode length) is caught by a snapshot
        # before the step, so load_env stays exact from here on.
        if getattr(env, "_max_episode_steps", None) != self._max_steps:
            self._max_steps = getattr(env, "_max_episode_steps", None)
            self._snapshot(env)
        rows = []
        for handle, action in applied.items():
            self.trajectory.action_collect(env_time=t, agent_id=int(handle), action=action)
            proposal = (proposed or {}).get(handle, action)
            rows.append((self.trajectory.ep_id, t, int(handle), _action_value(proposal), _action_value(action), (sources or {}).get(handle, "policy")))
        self._append(PROVENANCE_FILE, PROVENANCE_COLUMNS, rows)

    def after_step(self, env, rewards: dict, dones: dict, infos: dict, fired: Optional[list] = None) -> None:
        t = int(env._elapsed_steps)
        for agent_id, agent in enumerate(env.agents):
            self.trajectory.position_collect(env_time=t, agent_id=agent_id, position=agent.current_configuration)
            self.trajectory.rewards_dones_infos_collect(
                env_time=t,
                agent_id=agent_id,
                reward=rewards.get(agent_id, 0.0),
                info={k: v[agent_id] for k, v in infos.items()},
                done=dones[agent_id],
            )
        self.snapshots.on_episode_step(env=env, data_dir=self.folder)
        if fired:
            # A scripted disturbance changed the env outside env.step.
            self._snapshot(env)
            self._append(DISTURBANCES_FILE, DISTURBANCE_COLUMNS, [
                (self.trajectory.ep_id, t, event.get("agent_handle", ""), event.get("type", ""),
                 json.dumps({k: v for k, v in event.items() if k not in ("agent_handle", "type")}, default=str))
                for event in fired
            ])
        self._since_persist += 1
        if dones.get("__all__", False) and not self._done:
            self._done = True
            n = max(1, env.get_num_agents())
            success_rate = sum(agent.state == TrainState.DONE for agent in env.agents) / n
            # This episode's rewards: the rows persisted so far plus the buffer.
            persisted = self.trajectory.trains_rewards_dones_infos
            persisted = persisted[persisted["episode_id"] == self.trajectory.ep_id] if len(persisted) else persisted
            collected = self.trajectory._collected_trains_rewards_dones_infos_to_df()
            all_rewards = (list(persisted["reward"]) if len(persisted) else []) + (list(collected["reward"]) if len(collected) else [])
            normalized = env.rewards.normalize(*all_rewards, max_episode_steps=env._max_episode_steps, num_agents=env.get_num_agents())
            self.trajectory.arrived_collect(t - 1, success_rate, normalized)
            self.persist()
        elif self._since_persist >= PERSIST_EVERY:
            self.persist()

    # ── Files ───────────────────────────────────────────────────────────────

    def persist(self) -> None:
        self.trajectory.persist()
        # persist() keeps its collect buffers; cleared here so the next
        # persist does not write the same rows again.
        self.trajectory._actions_collect = []
        self.trajectory._trains_positions_collect = []
        self.trajectory._trains_arrived_collect = []
        self.trajectory._trains_rewards_dones_infos_collect = []
        self._since_persist = 0
        self._write_meta()

    def _snapshot(self, env) -> None:
        RailEnvPersister.save(env, str(self.folder / SERIALISED_STATE_SUBDIR / f"{self.trajectory.ep_id}_step{int(env._elapsed_steps):04d}.pkl"))

    def _append(self, name: str, columns: tuple, rows: list) -> None:
        if not rows:
            return
        path = self.folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        new = not path.exists()
        with path.open("a", encoding="utf-8") as f:
            if new:
                f.write("\t".join(columns) + "\n")
            for row in rows:
                f.write("\t".join(str(v) for v in row) + "\n")

    def _write_meta(self) -> None:
        (self.folder / "meta.json").write_text(json.dumps(self.meta, indent=2, default=str), encoding="utf-8")


def recorder_for(session) -> Optional[TrajectoryRecorder]:
    """The session's recorder, started on its first step; None when trajectories are off."""
    from app.config import settings

    if not settings.study_trajectories_enabled:
        return None
    recorder = getattr(session, "trajectory", None)
    if recorder is None:
        from importlib.metadata import version

        from app import __version__
        from app.core.study_paths import session_dir

        env = session.env
        meta = {
            "session_id": session.id,
            "run": session.run,
            "scenario_preset_id": session.scenario_preset_id,
            "infrastructure_scene_id": session.infrastructure_scene_id,
            "seed": session.seed,
            "max_episode_steps": getattr(env, "_max_episode_steps", None),
            "disturbances": session.disturbances,
            "rewards": type(getattr(env, "rewards", None)).__name__,
            "flatland_rl_version": version("flatland-rl"),
            "app_version": __version__,
            "snapshot_interval": settings.study_snapshot_interval,
        }
        recorder = TrajectoryRecorder(session_dir(session) / "trajectory", env, meta, settings.study_snapshot_interval)
        session.trajectory = recorder
    return recorder


def close_trajectory(session) -> None:
    """Persist and drop the session's recorder (delete); a later step starts a new one."""
    recorder = getattr(session, "trajectory", None)
    if recorder is not None:
        recorder.close()
        session.trajectory = None


def persist_trajectory(session) -> None:
    """Write what the session's recorder holds (playback paused): a leg the
    participant finishes before its episode ends is then on disk at once,
    not only after 50 steps, at the episode's end or on delete."""
    recorder = getattr(session, "trajectory", None)
    if recorder is not None and recorder._since_persist > 0:
        recorder.persist()


def close_all_trajectories(sessions) -> None:
    """Persist and close every live recorder (server shutdown), so a restart
    between participants loses nothing."""
    for session in sessions:
        close_trajectory(session)

