# PF-CH trained driver on main

## Scope and acceptance

The requested integration targets `main` (maintainer feedback, 2026-11-13),
superseding the `explore_db`-based PR #192. A direct retarget would include
159 unrelated commits and omit 114 newer main commits. Start at main fd0c70c
and port only the bundled specialist actor and its UI entry point.

Keep existing Plan B experiments, tours, stored IDs, defaults and human
control semantics. The new optional PF-CH tour selects `pf_ch_rl` before any
opening step, preserves it through Director/restart, runs for 320 steps and
uses the four scripted corridor incidents. Verify 16 arrivals and 48 serviced
intermediate calls; this is not a claim of generalisation or superiority.

## Design

### New files

| Files | Purpose |
|---|---|
| `backend/app/policies/learned/{ecml_observation,learned_ppo_policy,pf_ch_observation,pf_ch_bundle}.py`, package/license/checkpoint | Existing verified features, weights and CPU inference; no learner or lab dependency |
| `backend/app/core/stops.py` | Read native Flatland serviced-call truth |
| PF-CH-only control helper and backend regression files | Owned feature capture, drained worker inference, serial mutation and rejected incompatible selection |
| PF-CH corridor incident fixture | Same four incidents as the verified demo |
| Main-port validation artifacts | Fresh mission and resource evidence, with limits |

### Modified files

| Files | Change |
|---|---|
| Backend registry and session/play APIs | Lazy optional policy registration, compatibility preflight and truthful actor switching |
| Backend play/session control | Pure model forward in a worker; feature capture, overrides and physics remain synchronous; stop/drain before mutation |
| `Dockerfile` and documented setup | CPU Torch availability for the optional bundled actor |
| Frontend models/tours/layout/app/session store | Optional tour and lightweight layout, backend ACK before opening, explicit error on RL failure |
| EN/DE/FR translations and frontend tests | New labels and lifecycle regressions; French draft |

## OOM review and limits

The previous branch contains the separate online-learning stack and its
application lifespan autostart. Installing Torch can activate an additional
training process even during demos. Main has no such stack: do not import it
or its worker/buffers in this port. This is a concrete risk factor, not an
established diagnosis of the colleague's OOM without logs.

The inference asset is 288,717 bytes, ~70k parameters; this is not the runtime
RAM requirement. Torch/Flatland and environment forks dominate. Import Torch
only on explicit RL use, share frozen model weights and bound checkpoint-cache
retention across replacements. Use CPU tensors and inference without autograd.
Run heavy checks sequentially. Record fresh process memory for import, policy
load and repeated complete demo episodes; do not treat allocator high-water
marks or short-run measurements as proof of absence of all leaks.

No online training, training buffers, lab UI or unrelated dispatcher services
are included. Keep existing Plan B policy settings and infrastructure intact.

## Verification

Run backend suite serially under pinned Flatland 4.3.0; add focused controls,
compatibility, action-equivalence and repeated mission checks. Run frontend
style/i18n/production build and affected store/tour tests. Verify the served
production app and the complete API play mission with four disturbances.
Record exact commits/results/peak RSS and any remaining failures in this plan
and PR. Do not reuse previous explore_db test results as proof for this port.

## Reproduced rollout memory retention

A fresh actual API Play/Delete probe with ten 16-train, four-fault episodes
reached 16/16 arrivals and 48/48 native served calls at step197 every time,
but RSS after cleanup grew from342.5MB to523.0MB. Session weakrefs were free;
env and rail objects remained reachable through Flatland's native self-keyed
LRU caches (millions of possible transition entries, plus inherited
AbstractRailEnv helper caches). Clearing just the rail caches was insufficient.
Clearing rail and inherited env caches released earlier environments; the
latest native GlobalObs default retains one last env until another is built.

New lifecycle helper: explicitly clear the17 self-keyed native method caches
at disposal/reset boundaries using `functools.lru_cache.cache_clear`, without
patching Flatland or changing actions/physics. This drops other live sessions'
cache warmth; their values are recomputed. It is a lifecycle memory/performance
tradeoff, not a route/planning algorithm change. Regressions must verify a
second live environment still steps correctly.

Additional proven retention: the Director's weak-key cache held a
SchedulePlayer that strongly referenced its key env. `forget_env` now removes
that env's seven plan/player caches on deletion. The DELETE API stops/drains
its real actor first, including a PP comparison selected within an RL demo.
The scenario cache drops disposed sessions and rejects late forecast writes.

The repeated API probe excludes browser and HMI forecast load. Abandoned
non-demo study sessions, multiple concurrent users and a forecast already in
flight remain different workloads. No claim that every OOM is solved, and no
diagnosis of the colleague's exact crash without its trace/hardware.

The deployed action mask enforces rail/state action validity. This inference
path contains no formal ROAM checker or end-to-end deadlock/safety guarantee.

## Additional implementation files from OOM investigation

| New file | Purpose |
|---|---|
| `backend/app/core/native_env_cache.py` | Explicit17-method native cache disposal, no native monkeypatch |
| `backend/tests/test_native_env_cache.py` | Two live native environments and repeated regeneration/reset regression |
| `backend/tests/test_session_memory_cleanup.py` | Cache/session/player reachability and late forecast-write tests |
| `backend/tests/test_session_delete_playback.py` | Await actual actor drain before deletion; preserve another live run |
| `backend/tools/profile_pf_ch_rollouts.py` | Repeatable fresh-process API rollout/RSS probe, no training/browser |

Additional modifications: SessionManager.delete calls Director-cache and native
cache cleanup after closing its recorder. Reset clears retired native cache
keys. Toolbar keeps an unavailable RL selection visible and never substitutes
another actor for it; existing control selections are included alongside the
explicit tour policy before session creation.
