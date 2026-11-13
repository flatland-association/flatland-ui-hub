# Joint ROAM and infrastructure specialists

The registered `uc2_rl` policy now uses native whole-batch ROAM checking and
four frozen neural models selected only by immutable infrastructure identity.
Tutorial and UC2-3 retain the original model; UC2-1, UC2-2 and UC2-4 use
supervised specialist exports. No PP/DLA planner runs inside this driver.
The learning method is behavior cloning in the existing PPO actor
architecture. This is not evidence of a new PPO optimization gain.

The first problem was a conservative single-train veto: a follower could
not enter a resource being released in the same step. The existing upstream
JointRoamCheck allows conditional proposals and certifies their complete
native outcome before execution. Native motion, current malfunctions,
fractional speed, ordered missions and target removal remain unchanged.

## First frozen candidate: `861d3b9d`

| Comparison | Completed missions | Trains arrived | Cases later than PP | Neural lateness | PP lateness |
|---|---:|---:|---:|---:|---:|
| Old partial guard, known125 |125/125|350/350|68|2795|3272|
| Joint guard, original model, known125 |125/125|350/350|9|2648|3272|
| Joint guard, selected specialists, known125 |125/125|350/350|0|2592|3272|
| Selected specialists, fresh84 |84/84|248/248|4|2014|2557|

The original five demos have lateness **9 / 19 / 24 / 20 / 30**, versus
PP **9 / 19 / 24 / 50 / 30**. Their horizons and native faults are preserved.
The real registry driver independently reproduces the selected known125
results, rather than merely recombining separate model reports.

The fresh84 result does **not** satisfy per-case PP dominance: one UC2-1
case loses one step, and three UC2-2 cases lose one, twelve and thirteen
steps. All failures of that acceptance criterion are retained in the
[independent audit](confirmation84-independent-audit.json). Aggregate
lateness is 21.2% below PP, but this does not remove those counterexamples.
Makespan is separate: on known125, the last train finishes later in all
25 UC2-3 cases despite lower total lateness.

ROAM audits find no new stuck state, conflicting resource, uncached-reference
disagreement or unexplained prediction difference in these 209 episodes.
The 209 new-fault-associated differences are recorded separately; their
classification is not a per-difference causal proof. The guard certifies
autonomous proposals before the existing human override layer.

## Evidence and further development

- [Candidate lock](candidate-lock.json), frozen before fresh84 outcomes.
- [Actual known125 registry run](known125-runtime-locked.json) and
  [casewise PP comparison](known125-v2-vs-runtime-locked-vs-pp.json).
- [Fresh84 native run](confirmation84-runtime.json),
  [fixed PP reference](confirmation84-pp.json) and
  [independent source/input/model audit](confirmation84-independent-audit.json).
- [Exact tensor export audit](expert-export-roundtrip.json).
- A global forward-motion bias was rejected: it reduced some waits but
  increased original UC2-2 lateness from 24 to 72. Its counterexamples remain
  in the [rejected comparison](known125-v2-vs-v3-motion-bias6-rejected-vs-pp.json).

The original known125 and the now-inspected fresh84 are development data
for candidate two. Its training expands UC2-1 and UC2-2 timetable coverage.
The [next100 input protocol](confirmation100-v2-protocol.json) was fixed
before this additional training; its 20 reserved UC2 cases per map are
excluded from collection. Tutorial uses previously unused offsets 0..9,
with at least one offset >=7; this distribution change is explicit. No
candidate-two confirmation outcomes have been opened at this stage.

Local checks on candidate one: 964 backend tests passed, 22 skipped;
slow tier 19 passed, one skipped; style, translations and production build
passed. Backend runs used `DIRECTOR_PARALLEL=0`: the existing parallel
Director RNN workers crash natively on this macOS setup. Linux CI is a
separate required check. The UC2 neural driver has no Director worker.

Replay the actual driver from `backend/`:

```bash
python -m lab.marl.evaluate_uc2_roam_runtime \
  --cases ../docs/examples/uc2-roam-performance/inputs/known125-cases.json \
  --output lab/runs/uc2-runtime-replay.json
```

The existing five RL tour URLs and policy ID remain unchanged. Rebuild and
restart the local app to load the new backend and model assets. These
results cover five fixed native maps and the declared timetable variations;
they do not establish a universal map, disruption or deadline guarantee.
