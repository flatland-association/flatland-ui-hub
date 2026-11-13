# UC2 / tutorial trained neural driver

The bundled `uc2_rl` policy completes all five original native scenario fixtures with
all 14 trains, their scheduled malfunctions, native horizons and UC2-3's 0.6 speed.
The selected weights use verified PP/DLA trajectories and behaviour cloning in
the existing PPO actor architecture. The punctuality PPO experiment did not
improve the selected result and was not promoted. Runtime decisions use the
frozen network and native legal-action masks; there is no PP/DLA fallback.

## Run the actual scenarios

From the repository root, run `./start-demo.sh 8000 "" --rebuild`, then open:

- [Tutorial RL](http://127.0.0.1:8000/#/tour/uc2-rl-tutorial/start)
- [UC2-1 RL](http://127.0.0.1:8000/#/tour/uc2-rl-1/start)
- [UC2-2 RL](http://127.0.0.1:8000/#/tour/uc2-rl-2/start)
- [UC2-3 RL](http://127.0.0.1:8000/#/tour/uc2-rl-3/start)
- [UC2-4 RL](http://127.0.0.1:8000/#/tour/uc2-rl-4/start)

Rebuild when switching from an older branch or an existing local build; a warm
start otherwise keeps the previously built frontend.

These are separately labelled RL demos. The PlanB participant conditions retain
their DLA driver. The demos have no survey or study logging. Play, Pause,
restart and explicit policy selection keep the accepted backend actor. They
use the shipped `app/fixtures/plan-b/*/scenario.pkl` files directly, with no
horizon extension or replacement faults. CPU inference needs no GPU.

## Measured outcomes

All values below are native simulation steps, including summed lateness against
each train's latest arrival. The exact5 are declared training/demo targets.

| Original fixture | Trains arriving | Native horizon | Selected finish | Selected lateness | PP reference lateness |
|---|---:|---:|---:|---:|---:|
| tutorial |2/2|40|24|9|9|
| uc2-1 |3/3|168|89|19|19|
| uc2-2 |3/3|102|52|24|24|
| uc2-3 |3/3|240|128|39|50|
| uc2-4 |3/3|180|96|30|30|
| **Total** |**14/14**|—|—|**121**|**132**|

The selected driver reduces original-demo lateness by 8.3%. UC2-3 deliberately
finishes later than PP's 122 steps while reducing total lateness. Makespan and
punctuality are different objectives.

Training also uses 100 timetable variants, 20 per fixture. Development 20 and final 50
have independent departure-offset vectors 0..6. Rail, speeds, native fault
schedules and episode limits remain fixed; these measure new timetables on
known scenarios, not new-map generalisation. All pairs of operational input
sets are disjoint. The selected checkpoint was frozen at 13:01:48 UTC before
opening final outcomes; no final case was added to training or used to select
another checkpoint.

| Driver | Original 5 complete | Development 20 complete | Final 50 complete | Final arrivals | Final total lateness |
|---|---:|---:|---:|---:|---:|
| **Selected UC2 neural driver** |**5/5**|**20/20**|**48/50**|**135/140**|**1607**|
| Earlier PP-only BC driver |5/5|20/20|47/50|133/140|1967|
| Existing DLA default |4/5|16/20|40/50|126/140|1853|
| Original ECML reference |1/5|—|17/50|69/140|7137|
| Native PP with observed-fault repair |5/5|20/20|50/50|140/140|1316|

Selected development lateness is 459 versus 525 for PP. On the independent final
set, PP completes more missions and has lower overall lateness. The two
retained failures are UC2-1 departure offsets `[5,0,4]` and `[6,5,1]`; they
arrive 1/3 and 0/3 within the original 168-step horizon. This result supports the
five demos and a substantial improvement over the learned/DLA references; it
does not establish general superiority over PP or an optimal dispatcher.

Full casewise outcomes, including failures and native counter observations:
[results summary](results-summary.json), [all 250 paired records](final50-paired-results.json),
[independent audit](independent-audit.json), [frozen selection](selection-lock.json).

## Model, data and reproducibility

- Schema `uc2-context-v1`: 313 current-state inputs, explicit fixture identity,
  train/mission context, native speed and fractional progress; 5 legal action masks.
  No future fault list or teacher plan is an observation.
- 75,925 frozen parameters; portable runtime asset 312,931 bytes. It contains CPU
  tensors and primitive metadata, with no optimiser, RNG or private paths.
- 18,700 training rows: 12,847 verified PP and 5,853 verified DLA. DLA is selected only
  for UC2-3 TRAIN cases where a proved/live-completed trajectory has lower
  lateness. Exact-demo replay has multiplier 4. Provenance is preserved explicitly.
- Source checkpoint SHA: `c7d07cecb2bb8572247dd9a5fed8de829d933c48d9e557b0dbe6222c304e223e`.
- Runtime export SHA: `01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668`.
- Runtime manifest SHA: `3eb4255e58f3f8faa492feca7527087cf53f8c195aff6f46acb5bdd81804f944`.

The bundle checks model, manifest and all five native pickle hashes. It rejects
unsupported rail/stock/horizon identities. The previous PF-CH actor and its
272-feature contract remain separate.

[Reproduction recipe](reproduction-recipe.json) records the actual command
arguments, shard ordering, replay construction, software and seeds. The portable
[warmstart](warmstart-272.pt) contains tensors identical to the historic initial
272-feature actor; [its manifest](warmstart-manifest.json) records the original
source hash. Retraining across CPU/MPS or Torch versions need not reproduce
identical tensors or checkpoint files. Verify the resulting native missions.
The committed runtime can be run and verified without retraining.

From `backend`, verify inference on the declared originals:

```bash
python -m lab.marl.evaluate_pf_ch \
  --cases ../docs/examples/uc2-rl/inputs/exact5-cases.json \
  --checkpoint app/policies/learned/checkpoints/uc2_demo_ppo.pt \
  --output lab/runs/uc2-verification.json --threads 1
```

The result path must be fresh. The full [evidence index](evidence-index.json)
connects inputs, hashes, audits and recipe. Training runs use explicit TRAIN
roles; final 50 remains excluded.

## Runtime verification and memory

A same-page browser workload exposed an additional frontend retainer: the call
logger cached historical response JSON even when study logging was off. Heap
snapshots prove that three deleted/live sessions retained 5.81 MB of response
strings, dominated by `hmi/scenarios`. The fix scopes the cache to active logging
and the current session, bounds it to 64 entries, and preserves complete replay
responses after eviction. Correlation headers remain active.

| Eight full UC2-3 cycles, same page | Before cache fix | After cache fix |
|---|---:|---:|
| First → eighth GC JS heap (MB, decimal) | 14.50 → 29.25 | 12.46 → 13.49 |
| Post-warm-up OLS growth (bytes/restart) | 2,057,184 | 100,885 |
| Native mission result in each cycle | 3/3, step 128, lateness 39 | 3/3, step 128, lateness 39 |

The measured post-warm-up slope falls by 95.1%; DOM/listener counts stay flat.
The final heap snapshot finds one CallLog with an empty response cache. A smaller
positive heap trend remains over eight cycles; this is a bounded workload result,
not proof that every browser/OOM cause is eliminated. A longer restart workload
is being checked separately. [Before](browser-restart-memory.json),
[retainer proof](browser-cache-retainer.json), [after](browser-restart-memory-after.json).

The selected weights passed five real production-browser tours: 14/14 arrivals,
five observed native faults, UC2-3 fractional speed, Pause/restart, accepted
actor retention, terminal stopped acknowledgements, no survey controls and
zero Director calls/application errors. [Browser evidence](browser-proof.json)
also records the separately observed external SBB icon 403 responses.

The actual selected bundle completed 25 normal REST API episodes: 70/70 arrivals,
25 faults, all 100 session/env/rail/builder weak references collected, zero sessions
left and one shared model. Current Mach RSS averaged 309.81 MiB after warm-up and
310.05 MiB over the final five cycles (+0.24 MiB; last-five range 16 KiB).
[Selected-bundle memory evidence](api-lifecycle-selected25.json) excludes browser,
HMI and concurrent forecast memory. The earlier 50-episode check is retained
separately in [baseline architecture evidence](api-lifecycle-stress50.json).

Native cache disposal loses other live sessions' cache warmth; their pure
results are recomputed. It does not change their rail or physics. Legal-action
masking is not a formal ROAM safety checker, and reliability after arbitrary
human rerouting or on other Flatland maps has not been established.

Validation evidence: the final selected-model [clean backend suite](backend-verification.json)
passes 882 tests (22 skipped). [Linux CI](linux-ci-verification.json) on the
published usable snapshot passes the same 882 tests, 20 slow tests and frontend
gates/build. The browser-cache fix additionally passes [226 local Angular tests](frontend-verification.json),
including study logging and replay, plus style/i18n and production build.
