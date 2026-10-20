# Train dynamics probe — vehicle physics in the hub (branch Explore_hardware)

> Dated plan, 2026-10-20. Status: **probe built and measured (2026-10-20); not for explore_db.** Exploration of
> Adrian Egli's [`flatland_railway_extension`](https://github.com/aiAdrian/flatland_railway_extension)
> (`FlatlandDynamics`) on our flatland-rl 4.2.6.

## Question

What would full vehicle dynamics (traction-based acceleration, braking,
maximum speed per cell, train length, braking distance reserved ahead) change
in the hub, and what does it take to run it on Flatland 4?

## Findings before building (2026-10-20)

- The package (0.2.12, env code last changed spring 2023) does not run on
  flatland-rl 4.2.6: `MultiResourcesAllocationRailEnv` fails in `reset()`
  (`get_transitions()` signature), `FlatlandDynamics` fails on import
  (`DistanceMap` is gone), `RailroadSwitchAnalyser` fails like the first.
- The env classes override `RailEnv.preprocess_action`, which Flatland 4's
  `step()` no longer calls (motion check and state machine were rebuilt). They
  cannot be patched; the dynamics have to be rebuilt around the new step.
- The physics core is plain Python and portable: `RollingStock` (traction,
  resistance, braking), `DynamicAgent.update_movement_dynamics` (reservation
  point = front of train + braking distance; train end tracked by distance),
  `FlatlandResourceAllocator` (several cells per train, minimum headway).
- **Licence.** The repo's LICENSE is MIT with a credit clause, but
  `FlatlandDynamics.py` and `DynamicAgent.py` say in their headers: *no
  commercial use, neither the idea nor the implementation*. The hub is Apache
  2.0, which allows commercial use. So that code must not go into this repo
  as it is. Only Adrian can clear it.

## Design of the probe

- **The port stays local.** `backend/vendor_local/flatland_dynamics_port/`
  holds the ported physics, credited and with the original headers, and is
  excluded from git (`.git/info/exclude`), so it cannot be pushed by accident.
- **Our hooks are optional,** like torch: `app/core/train_dynamics.py` finds
  the local package; without it the option simply does not exist.
- **A controller around `env.step`** (no subclass, no Flatland internals):
  - Before the step: each train holds the cells from its end to its
    reservation point. A train whose next cell is held by another train brakes
    hard and gets `STOP_MOVING`. The physics then decide whether the
    reservation point may move on this step; if not, `STOP_MOVING` keeps the
    Flatland position (= the reservation point) where it is.
  - After the step: the train's path, end and speed are updated.
- **Scale.** Cells are 400 m (the extension's default; PF-CH is roughly
  360 m per column). One step lasts `dt = 400 m / 100 km/h = 14.4 s`, so a
  train at line speed still covers one cell per step, as today. Accelerating,
  braking and slow switches (60–80 km/h) make it slower; that is the effect
  we want to see.
- **Where it is switched on:** `create_env(..., dynamics=True)` and the session
  request field `dynamics`. What-if forks carry the controller along.
- **What the HMI shows (probe level):** speed and occupied cells per train in
  the train detail.

## Built (2026-10-20)

- **Local port** (`backend/vendor_local/flatland_dynamics_port/`, not in git):
  `rolling_stock.py`, `infrastructure.py`, `resource_allocator.py` (MIT with
  credit clause), `train_physics.py` (from `DynamicAgent`, non-commercial),
  `controller.py` (Flatland-4 rebuild of `FlatlandDynamics`, non-commercial).
  The controller is installed as a derived env class, so `copy.deepcopy(env)`
  (the Director's forks) copies it along instead of stepping the original.
- **Hub hooks** (in git, Apache-2.0, own code): `app/core/train_dynamics.py`;
  session request field `dynamics` and `SessionInfo.dynamics`
  (`session_manager`, `api/sessions.py`); per-agent `dynamics` in the state
  (`serializer.py`); what-if forks carry the controller
  (`scenario_runner._fork_env`); `evaluate.py --dynamics off|on|both`.
- **Frontend**: start screen "Vehicle dynamics (probe)" in the Build door;
  train detail shows speed, max speed, cells held and "braking"; the map tints
  every held cell in the train's colour (stronger while braking).
- **Tests**: `tests/test_train_dynamics.py`. The gating tests run everywhere;
  the five physics tests skip where the port is missing (CI).

## Measured (2026-10-20)

`python -m lab.marl.evaluate --dynamics both`, no human, episode limit of the
scenario unchanged (so slower trains can run out of time). Arrived / total
delay:

| Scenario | DLA | DLA + dyn | Shortest Path | SP + dyn | Learned PPO | PPO + dyn |
|---|---|---|---|---|---|---|
| gen 30×30, 5 trains | 5/5, 0 | 4/5, 9 | 5/5, 0 | 4/5, 9 | 5/5, 0 | 4/5, 12 |
| gen 36×24, 7 trains | 7/7, 0 | 4/7, 14 | 4/7, 13 | 2/7, 36 | 4/7, 13 | 2/7, 36 |
| PF-CH wn–wal conflict | 3/3, 3 | 3/3, 80 | 0/3 | 0/3 | 1/3, 150 | **3/3**, 172 |
| PF-CH wn–wal long approach | 3/3, 0 | 3/3, 61 | 0/3 | 0/3 | 3/3, 0 | **0/3**, 263 |
| ECML 2026 scene 1 | 6/6, 33 | 4/6, 672 | 2/6 | 2/6 | 6/6, 0 | 6/6, 208 |
| PF-CH corridor (16) | 11/16, 185 | 5/16, 460 | 1/16 | 1/16 | 1/16 | 1/16 |
| **total** | **35/40, 221** | 23/40, 1296 | 12/40, 2293 | 9/40, 2375 | 20/40, 671 | 16/40, 1199 |

Cost: no measurable overhead per step (0.2–6 ms/step, as without dynamics).

**Reading:**

1. **Physics makes everything slower**, as it should: acceleration from
   standstill takes several steps (0 → 36 → 71 → 80 km/h), switches are taken
   at 60–80 km/h, and a train holds 2–3 cells (its length plus braking
   distance). DLA's total delay grows from 221 to 1296 steps, and fewer trains
   make it within the unchanged episode limits.
2. **It changes who solves what.** The learned PPO now solves the wn–wal
   conflict (the reserved braking distance spaces the trains out) but loses
   the long approach: the trains meet elsewhere than in plain Flatland and end
   in a head-on deadlock at cells (0, 104)/(0, 105). That is a real deadlock,
   checked step by step, not a controller fault. Policies trained or tuned
   without physics are off their distribution.
3. **The corridor halves DLA's arrivals** (11 → 5 of 16): DLA's look-ahead
   knows nothing of braking distances or occupied cells behind the front.

Verified in the hub on port 8001 (worktree build): session with dynamics on
the wn–wal conflict and on a random network; train detail "79.6 km/h (max 80) ·
3 cell(s) held"; held cells drawn on the map; DLA holds two trains for the
counter-train with the braking flag set.

## Known simplifications

- A train counts as arrived when its reservation point reaches the target,
  so it arrives about one braking distance early.
- No gradients (the extension had no gradient over train length either, its
  issue #24).
- One rolling-stock profile for all trains.
- Plans (`PlanPolicy`, PP/CBS) still assume one cell per step. The Director's
  plan verification (`/director/verify`) forks without dynamics.
- Policies see the reservation point as the train's position; nothing tells
  them a train is still braking into its block.

## Next, if we go on

1. **Licence first.** Ask Adrian whether the dynamics code may be relicensed
   (MIT, like the rest of his repo). Without that, nothing of the port can go
   into the hub, and a clean-room rewrite would still touch "the idea" his
   header names.
2. Scenario-level physics: cell lengths and speeds from the scenario's
   geography (PF-CH has station kilometres), instead of one grid for all.
3. Give policies the dynamics they act in: speed and braking state in the
   observation; DLA's look-ahead aware of held cells.
4. Time scale in the HMI: one step is 14.4 s with dynamics; the timetable and
   the Zug-Weg-Diagramm still read one step as one minute.
