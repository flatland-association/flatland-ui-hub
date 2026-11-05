"""Classes from unreleased flatland-rl, registered where flatland will have them.

TODO remove once ui-hub runs a flatland-rl that ships
`ScheduledMalfunctionEffectsGenerator` (flatland-rl PR
`feat/scheduled-malfunction-effects-generator`). The experiment scenario `.pkl`s
then load from flatland's own class and need no regeneration
(docs/plans/experiment-scenario-import.md §3.6).

A `.pkl` stores its effects generator as a class path, which
`EffectsGenerator.from_state` imports. The scenarios are written by
flatland-scenarios' `scenario_generator` with the same compat copy, under
flatland's future path, so this copy is attached to that module — only if
flatland does not have the class yet. Imported by `app.core.scenario_presets`,
which every `.pkl` load goes through.
"""
from __future__ import annotations

import warnings
from typing import List, NamedTuple, Union

from flatland.core.effects_generator import EffectsGenerator
from flatland.envs import malfunction_effects_generators as _mfg

_MODULE = _mfg.__name__


class ScheduledMalfunction(NamedTuple):
    """The agent `handle` breaks down at `step` (`RailEnv._elapsed_steps`
    during `step()`, so the first `step()` is step 1) for `duration` steps."""
    handle: int
    step: int
    duration: int


class ScheduledMalfunctionEffectsGenerator(EffectsGenerator["RailEnv"]):
    """Deterministic malfunctions: each `ScheduledMalfunction` breaks one agent
    at a given step for a given number of steps. An agent already in
    malfunction keeps it; the scheduled one is skipped with a warning."""

    def __init__(self, malfunctions: List[Union[ScheduledMalfunction, List[int]]] = None):
        super().__init__()
        self._malfunctions = [ScheduledMalfunction(*m) for m in (malfunctions or [])]
        for m in self._malfunctions:
            if m.step < 1:
                raise ValueError(f"{m}: step must be >= 1, the first call to step() is step 1.")
            if m.duration < 1:
                raise ValueError(f"{m}: duration must be >= 1.")

    @property
    def malfunctions(self) -> List[ScheduledMalfunction]:
        return list(self._malfunctions)

    def on_episode_step_start(self, env: "RailEnv", *args, **kwargs) -> "RailEnv":
        for m in self._malfunctions:
            if m.step != env._elapsed_steps:
                continue
            handler = env.agents[m.handle].malfunction_handler
            if handler.in_malfunction:
                warnings.warn(f"Scheduled malfunction {m} skipped: agent {m.handle} already in malfunction "
                              f"(malfunction_down_counter={handler.malfunction_down_counter}).")
                continue
            handler.malfunction_down_counter = m.duration
        return env

    def __getstate__(self):
        return {
            "cls": self.fullname,
            "specs": {
                "kwargs": {
                    "malfunctions": [list(m) for m in self._malfunctions],
                }
            }
        }


def _register() -> None:
    for cls in (ScheduledMalfunction, ScheduledMalfunctionEffectsGenerator):
        if hasattr(_mfg, cls.__name__):
            continue
        cls.__module__ = _MODULE
        setattr(_mfg, cls.__name__, cls)


_register()
