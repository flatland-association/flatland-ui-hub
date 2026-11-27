"""Per-env lock and cancel flag for a live session's env.

A forecast forks the live env (`TrajectoryBranchRunner._fork_env`) from a worker
thread while the play loop or `/step` steps it. Flatland's step leaves
`agent.current_configuration` unset for a moment, so a fork taken in between
failed with an `AssertionError` (E2E known bug 3, issue #117). Both therefore
take `env_lock`: the step holds it for the step only, the fork for the save
only, so neither waits for a forecast to finish.

`DELETE /session/<id>` calls `cancel_forecasts`, so the forecasts of a deleted
session stop at their next step instead of running for minutes and starving
the next session's requests (issue #118). Python cannot stop a thread from
outside, so a forecast stops where it checks `raise_if_cancelled`.

They are kept beside the env, not on it: the env is deep-copied and pickled
in places, and a lock cannot be. A fork (a new env) has neither.
"""
import threading
import weakref

_locks: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
_cancels: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()
_init = threading.Lock()


class ForecastCancelled(Exception):
    """The session a forecast belongs to was deleted while it ran."""


def _get(registry, env, factory):
    with _init:
        value = registry.get(env)
        if value is None:
            value = registry[env] = factory()
        return value


def env_lock(env) -> "threading.RLock":
    return _get(_locks, env, threading.RLock)


def cancel_forecasts(env) -> None:
    _get(_cancels, env, threading.Event).set()


def raise_if_cancelled(env) -> None:
    flag = _cancels.get(env)
    if flag is not None and flag.is_set():
        raise ForecastCancelled("session deleted")
