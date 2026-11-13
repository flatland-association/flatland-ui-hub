# ROAM added to the frozen UC2 neural driver

**Result: both existing ROAM variants reach 50/50 complete missions on the
historical benchmark and another 50/50 on previously unused timetable variants.**
The actor weights and all 313 feature values are unchanged. No PPO update,
PP/DLA fallback, forced movement, episode extension or future-fault lookup is
used. The UI/runtime still uses the original unguarded actor. This tested offline
extension and its results are included in PR196; activating ROAM in the UI
remains a separate integration step. The experiment branch is
`codex/uc2-roam-eval-20261113`.

## Paired outcomes

Lateness is summed native simulation steps. Unfinished trains accrue lateness
through the native horizon, as in the original benchmark.

| Variant | Original 5 complete / lateness | Development 20 complete / lateness | Historical 50 complete / lateness | New 50 complete / lateness |
|---|---:|---:|---:|---:|
| V0: frozen actor, original legal mask |5/5 ·121|20/20 ·459|48/50 ·1607|49/50 ·1592|
| V1: same actor + serial ROAM + withdrawal |5/5 ·132|20/20 ·482|50/50 ·1274|50/50 ·1285|
| **V2: same actor + partial-move ROAM + withdrawal** |**5/5 ·117**|**20/20 ·422**|**50/50 ·1139**|**50/50 ·1117**|
| Native PP with observed-fault repair |5/5 ·132|20/20 ·525|50/50 ·1316|50/50 ·1299|

The historical PP rows are the previously published reference; new50 PP was
rerun with the same `pp-trainruns-replan` method. All 50-case cohorts contain
140 train missions. Both guards deliver 140/140 on each 50-case cohort.

V2 is preferred from the original/development cases. Both variants and their
parameters were frozen in source commit
`dd2724d2ee64d361117fca187c01c31d30307618` before confirmation outcomes.
The new50 manifest was created at 17:25:26 UTC with seed 202611131725, ten vectors
per fixture, offsets 0..6, excluding all 175 previous operational cases.
[Protocol](confirmation-protocol.json) and [independent confirmation audit](confirmation-audit.json)
record zero overlaps and unchanged fixtures/checkpoint/source. The historical50
is now an inspected regression set, not a new blind generalisation result.

## What ROAM changes

The reused MIT checker is the existing Flatland implementation of **Reserve Only
if All Missions stay achievable**. V1 tests a sufficient serial-completion
certificate. V2 additionally permits the existing bounded partial-move proof
(`max_candidates=60`), recognising passing opportunities where one train first
moves to an intermediate position. Both intersect only the appended five-action
mask and then run native-consistent joint withdrawal. The original 313 model
features remain byte-for-byte equal within each decision.

The two historical UC2-1 failures are genuine opposing-track blocks. The guard
protects the remaining passing opportunity, briefly holding a train; the same
network then chooses an already-scored alternate branch. For example, one
unguarded decision gives FORWARD 0.695 versus LEFT 0.305; vetoing unsafe FORWARD
lets the unchanged policy choose LEFT. It does not call a dispatcher to rescue
the rollout. [Failure mechanism](failure-mechanism.json) retains the nine changed
historical decisions and original trace hashes.

| Historical failure | V0 | V1/V2 |
|---|---|---|
| UC2-1 offsets `[5,0,4]` |1/3 arrivals; lateness 177|3/3; finish 119; lateness 52|
| UC2-1 offsets `[6,5,1]` |0/3 arrivals; lateness 257|3/3; finish 95; lateness 19|

## Tradeoffs and correctness

- V2's lower totals do **not** mean every timetable is faster. In historical50,
  12 cases improve, 14 tie and 24 become later; in new50, 11 improve, 17 tie and 22
  become later. There are no completion regressions. Across the 48 historical
  cases already completed by V0, V2 reduces lateness by 105; repairing the two
  timeouts contributes the remainder of the 468-step aggregate improvement.
- V1 is more conservative: historical lateness is 1274 and 30 individual cases
  become later. Partial-move certificates reduce this unnecessary restriction.
- All observed post-step guarded states retain their configured certificate;
  new stuck sets, resource conflicts and cached/uncached disagreements are zero.
  Prediction differences occur at new native malfunction onset and are reported
  separately. The checker cannot inspect future event schedules. Failed
  sufficient certificates in V0 are not automatically physical deadlock proofs.
- The actor itself may still choose to wait; ROAM is not a progress or deadline
  guarantee. Only these five small infrastructures, at most three trains, their
  native fault schedules and timetable offsets 0..6 have been evaluated.
- Historical instrumented step-weighted decision means are approximately 0.350 ms
  (V0), 0.668 ms (V1), 0.669 ms (V2). This diagnostic path excludes the separate
  counterfactual inference, audit and env.step; audits warm checker caches and
  reset costs are not comparable. These are **not** uninstrumented production
  throughput or larger-map performance claims, and no global p95 is inferred
  from per-case percentiles.

The [35 focused tests](verification.json) cover fixed graph expectations,
individually-safe/jointly-unsafe actions, withdrawal dependencies, waypoints,
grade-separated resources, immediate-braking assumptions, off-map admission,
fractional 3/5 speed and native malfunction/recovery, plus both end-to-end failures.
The [historical independent audit](historical-audit.json) confirms 300 baseline
field comparisons against the published model without a mismatch. No new
dependencies were installed and no application/frontend/checkpoint was changed.

## Reproduce

Use the existing backend environment with Flatland 4.3.0, Torch 2.14.0 and NumPy 1.26.4.
From `backend`, with fresh output paths:

```bash
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
python -m lab.marl.evaluate_uc2_roam \
  --cases ../docs/examples/uc2-roam/inputs/final50-cases.json \
  --output lab/runs/roam-reproduction/historical50.json --threads 1

OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
python -m lab.marl.evaluate_uc2_roam \
  --cases ../docs/examples/uc2-roam/inputs/confirmation50-cases.json \
  --output lab/runs/roam-reproduction/confirmation50.json --threads 1

python -m pytest -o addopts= -q \
  tests/test_uc2_roam_check.py tests/test_uc2_roam_evaluation.py
```

Frozen checkpoint SHA256:
`01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668`.

[Summary](results-summary.json), [historical casewise outcomes](historical50-comparison.json),
[new casewise outcomes](new50-comparison.json), [new PP reference](confirmation50-pp-reference.json),
[original5](exact5-comparison.json), [development20](dev20-comparison.json),
[evidence index](evidence-index.json), [plan](../../plans/uc2-roam-evaluation.md).
