# UC2 adviser: paired DLA takeover diagnostics

The bounded lookahead improves eight of 46 frozen takeover cases and preserves
the other 38. Both versions finish every train in 44 cases (126 of 128 train
missions). This is development evidence from repeated states of five known
fixtures, not an independent holdout or a generalization result.

| Native map | Fully completed cases, before / after | Native completed-train lateness, before / after |
|---|---:|---:|
| Tutorial | 8 / 8 of 10 | 140 / 138 |
| UC2-1 | 9 / 9 | 543 / 372 |
| UC2-2 | 9 / 9 | 240 / 231 |
| UC2-3, including speed 0.6 | 9 / 9 | 236 / 226 |
| UC2-4 | 9 / 9 | 807 / 697 |
| Total | 44 / 44 of 46 | 1,966 / 1,664 |

On the 44 cases completed by both advisers, native lateness falls from 1,954
to 1,652 steps, a reduction of 302 steps (15.5%). The two remaining incomplete
tutorial cases start at steps 20 and 26. UC2-1 at step 30 with selected handle 1
still has 72 lateness steps; bounded alternatives for that selected train do
not resolve every bad takeover state.

The strongest measured improvements are UC2-1 at step 16, handle 2 (72 to 19),
UC2-1 at step 40, handle 2 (143 to 25), and UC2-4 at step 45, handle 2 (145 to
38). See `paired-summary.json` for all eight changes and their future
interventions. No case loses a completion or has a worse ranking.

## Frozen inputs and comparison

`takeover-cases.json` was written before evaluating the new adviser. Its SHA256
is `7646f339cbb35e07ed01381cf832b29e7774f193580e1badd63d9d1202d16028`.
Fixed takeover clocks were declared per map, including tutorial 6/15 and
UC2-1 30. The selected handle cycles through trains not yet done at that DLA
state. Four later clocks were omitted because DLA had already finished the
episode, leaving ten tutorial cases and nine per UC2 map. Each case records
the actual source state and its hash.

All cases preserve their original persisted scenario, faults, train speeds
and native horizon: tutorial 40, UC2-1 168, UC2-2 102, UC2-3 240 and UC2-4 180.
The baseline Driver is DLA, with no standing human overrides. The source env
remains unchanged during adviser generation and candidate replay.

The BEFORE implementation is `rollout_trainruns` extracted directly from Git
commit `a1b9c7b01d20064be9e6e37790717ecaeda82f8f`. Both measurements use the same
frozen models and runtime from `9a0af324c1bea5933507b0edc68f4540fd803249`.
Source, model and fixture SHA256 values are in both result files. The new
adviser's greedy candidate has exactly the same timed trainrun hash as the
original function in all 46 cases. No model training took place.

Every proposed course is independently replayed through the real
`TrajectoryBranchRunner` and `PlanPolicy`. Both versions are ranked with the
new API's common `proposal_arrival_reference` and `proposal_rank`: incomplete
trains first, then nonnegative lateness, then remaining time in the network.
UC2 has no timetable trainrun mapping, so the common reference uses the native
`latest_arrival` deadlines. Historical API metrics are retained separately;
their absent references previously made UC2 lateness zero. They are not used
to select the winners in this paired comparison.

`native_completed_lateness` includes already completed trains' immutable
lateness. API lateness compares only arrivals after the takeover. These differ
by the same already incurred amounts in each paired case; both reductions
are 302 steps. Missing trains are reported separately rather than being
presented as having zero-delay successful missions.

## Cost and cleanup

The lookahead returns two to six distinct courses in this suite (configured
maximum eight). With one Torch/BLAS thread, generation latency is median
0.379 s, nearest-rank p95 0.686 s and maximum 0.807 s. Generation plus independent
replay of every candidate takes at most 1.572 s. Greedy generation is median
0.060 s and maximum 0.115 s. These timers exclude process/module startup and
the separate baseline-Driver forecast, HTTP and browser rendering.

Every case leaves zero temporary override sessions and zero entries in the
seventeen explicitly cleared native self-keyed LRUs. Peak process RSS is
approximately 307 MB for BEFORE and 393 MB for AFTER; this is process memory,
not browser or deployment-wide memory.

## Use the adviser in the UI or an integration

The Plan B conditions request `proposal_agent: "uc2_rl"` independently of
their pinned `deadlock_avoidance` Driver. The separate RL demo tours remain
autonomous drivers; they are not the adviser surface. Start a Plan B run,
select a train and open **Handlungsoptionen**. The Plan column forecasts the
current Driver; the KI column shows an executable whole-system course.
**Weitere KI-Verläufe** exposes the remaining scored candidates. **Diesen
Verlauf anzeigen** changes only the preview and its map overlay. **KI-Plan
übernehmen** is the separate actuation step.

The API remains additive:

1. Create a native UC2 session with `proposal_agent: "uc2_rl"` and the ordinary
   Driver. Sessions without the field retain their existing proposal agent.
2. `GET /session/{id}/proposals?handle=2&alternatives=8` evaluates all trains
   jointly on a coherent copied root. `variants` contains Plan and the selected
   KI course; `ai_alternatives` contains the other courses. Each AI course has
   `candidate_id`, `intervention`, `preview_token`, metrics and trajectories.
3. Accept the exact chosen object, sending its fields back:

```json
{
  "variant": "ai",
  "handle": 2,
  "candidate_id": "<chosen candidate_id>",
  "preview_token": "<chosen preview_token>",
  "source_step": 16,
  "priority": []
}
```

`source_step` is the response's `source_step` (or `step` for an older server),
not the future intervention's clock. Send the object to
`POST /session/{id}/proposals/apply`. A valid token installs the exact
trainruns used for scoring; it never re-solves a different best course on
acceptance. Changed state, Driver, overrides, selected handle or candidate,
reset/deleted sessions and evicted tokens yield **409 with no mutation**.
The UI discards that forecast and offers a refresh. Pause the simulation
before inspecting a course when a stable decision point is needed.

Acceptance installs a whole-system PlanPolicy course, including waits; it
does not merely apply a next-action override. Playback follows that course
even while the Plan B client keeps pinning DLA, and a second accepted plan
replaces the first. Ordinary older clients and PP priority orders retain
their existing acceptance path. The neural adviser uses no PP search or
online training. All candidate interventions pass the joint ROAM check.

Forecast workers are bounded to two active plus two queued jobs; per-session
preview storage holds at most 16 courses, with trainruns and source digests
only, never environment copies. GET does not change the live Driver or stop
playback; pause/reset remain responsive while forecasts use their copies.

## Reproduce

Run from `backend/`, using the project Python environment and one thread:

```sh
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
export ONLINE_LEARNING_AUTOSTART=0 STUDY_TRAJECTORIES_ENABLED=0
python tools/evaluate_uc2_adviser.py --mode baseline --out ../docs/examples/uc2-rl-adviser/before-greedy.json
python tools/evaluate_uc2_adviser.py --mode lookahead --out ../docs/examples/uc2-rl-adviser/after-lookahead.json
python tools/evaluate_uc2_adviser.py --mode compare --before ../docs/examples/uc2-rl-adviser/before-greedy.json --after ../docs/examples/uc2-rl-adviser/after-lookahead.json --out ../docs/examples/uc2-rl-adviser/paired-summary.json
```

The helper rejects changed case manifests, mismatching paired runtime/model
pins, differing greedy courses and mutated source states. The original Git
commit must be available locally. All JSON paths are relative to `backend/`.

## Validation and browser proof

[Final Linux CI](https://github.com/flatland-association/flatland-ui-hub/actions/runs/43908914662)
on `9a0af324` passes **1,060 backend tests / 22 skipped**, **20 slow tests /
2 opt-in-training skips**, frontend styles, all49 logged click IDs/translations
and the production build. See [portable CI evidence](ci-final.json).
The initial local full suite passed1,057 tests/22 skips; the three additional
native tests preserve the existing250-step cap for non-UC2 advisers while
UC2 uses its native remaining horizon. New code does not change model weights.

The [production-browser proof](browser/README.md) checks two real Plan B
flows: UC2-1's future branch and a deliberately selected non-default Tutorial
wait course. Train selection, alternative inspection, stale refresh and
acceptance use actual page controls. Test-clock positioning and subsequent
accelerated Play use explicit browser API controls; their requests still pin
DLA. Realised arrivals and240 live train positions match the displayed
PlanPolicy forecasts. Stale acceptance produces409 and no logged choice.
Both owned sessions are deleted and no page/WebSocket error occurs.

Browser application source is `2c22f037`; the subsequent isolated API fix only
restores non-UC2 horizon bounds, while native UC2 behavior stays identical.
The final singular wait-label copy correction preserves this contract.
The native paired diagnostic files were rerun on `9a0af324`, with identical
outcomes and verified current runtime/model hashes. These scopes are kept
explicit instead of treating older screenshots as new-source executions.
