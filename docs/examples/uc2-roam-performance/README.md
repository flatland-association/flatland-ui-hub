# UC2 neural driver with Joint ROAM

The registered `uc2_rl` driver completes the entire declared **1,472-case
finite domain** with **4,316/4,316 arrivals** and no individual case having
greater summed native lateness than the fixed PP reference. Total lateness
is **34,368 versus 43,599**, a **21.17% reduction**.

This final C4 **known-domain regression** includes training and previously
inspected confirmation cases. It is not a new holdout or a guarantee for
arbitrary Flatland maps. Earlier failed independent confirmations remain
published below.

## Final comparison

The domain is all departure-offset triples in `0..6` on UC2-1 through UC2-4,
plus all tutorial offset pairs in `0..9`: `4 × 7³ + 10² = 1,472`.
Native seed 0, horizons, train speeds and fault schedules remain unchanged.
Both methods complete every case and every train.

| Infrastructure | Cases | Neural lateness | PP lateness | Better / equal / worse cases |
|---|---:|---:|---:|---:|
| Tutorial | 100 | 823 | 826 | 3 / 97 / 0 |
| UC2-1 | 343 | 6,552 | 6,552 | 0 / 343 / 0 |
| UC2-2 | 343 | 8,397 | 8,397 | 0 / 343 / 0 |
| UC2-3 | 343 | 7,922 | 17,150 | 337 / 6 / 0 |
| UC2-4 | 343 | 10,674 | 10,674 | 0 / 343 / 0 |
| **Total** | **1,472** | **34,368** | **43,599** | **340 / 1,132 / 0** |

**Makespan is a separate tradeoff.** The last train finishes earlier in 8
cases, at the same time in 1,132, and later in 332 UC2-3 cases, by up to 14
steps. The primary comparison concerns completion and summed lateness; it
does not establish dominance for every metric or every individual train.
PP here is the fixed bounded prioritized-planning reference, not an optimal
schedule or a best-of-all-possible-priority-orders oracle.

The five original tours have lateness **9 / 19 / 24 / 20 / 30**, compared
with PP **9 / 19 / 24 / 50 / 30**: **102 versus 132**, with 14/14 arrivals.
The existing five RL tour URLs and policy ID remain unchanged. Plan B
participant defaults remain unchanged.

## What changed and what ROAM contributes

Runtime uses five frozen neural specialists, selected only by immutable
infrastructure identity, with native **JointRoamCheck** certification of the
complete proposed action batch. It never selects by timetable vector, case
ID or future fault, and never invokes a PP/DLA runtime rescue.

The old single-train/partial guard could veto a follower entering a resource
that another train released in the same step. The existing upstream joint
checker permits conditional proposals, then checks their actual joint native
motion and resource outcome. Its algorithm remains upstream; this work
integrates and validates it in the registered driver. ROAM protects remaining
mission feasibility under its configured sufficient certificate. It does
not choose an efficient timetable or ensure progress by itself.

On the same known125 cases with the original network, switching from the
partial guard to the joint guard reduces PP-lateness counterexamples from
**68 to 9**, and total lateness from **2,795 to 2,648**. That isolates the
guard's benefit. Final gains additionally require denser supervision and
specialist corrections; they cannot all be attributed to ROAM.

Another defect affected tutorial recovery: the legacy observation mask
treated `MALFUNCTION_OFF_MAP` as done even after its counter reached zero.
The UC2 adapter now permits the physically valid native entry actions,
without changing the 313 feature values, physics or fault schedule. Teacher
collection also preserves an explicitly legal off-map STOP, which differs
physically from NOOP.

Training uses behavior cloning and, for UC2-3/tutorial corrections,
supervised labels with a frozen-neural KL prior in the existing PPO actor
architecture. UC2-3 provenance distinguishes genuine PP actions from
projected-safe STOP labels. The tutorial's final LEFT label is a genuine
native PP action. **This is not evidence of a new PPO gradient optimization
gain.** Original UC2 and PF-CH baseline assets remain unchanged. The existing
shared CPU model cache remains bounded to four entries.

The actual registered-driver replay has zero technical failures, new stuck
states, conflicting resources, uncertified steps, uncached-reference
disagreements or unexplained native prediction differences. It records
three joint withdrawals and 1,452 prediction differences co-occurring with
newly observed faults. That classification is not a causal proof for each
difference. The guard certifies autonomous proposals before the existing
human override layer; arbitrary human overrides are outside this certificate.
Instrumented, cache-warmed decision timings are not cold-start or large-map
throughput measurements.

## Evidence and limits

- [Final frozen source/model/input lock](final-regression-lock-v4.json).
- [All 1,472 paired final outcomes](systematic1472-candidate4-vs-pp.json) and
  [independent audit](candidate4-final-independent-audit.json), including
  selected models, fault witnesses, guard counters, fixture identities and
  the full private raw-report digest.
- [Fixed PP outcomes](pp-reference-systematic1472-v3.json) and
  [independent PP source audit](pp-reference-systematic1472-independent-audit.json).
  The reference is assembled from seven actual native PP collection/evaluation
  sources, not described as a newly rerun 1,472-case solver job.
- [Exact exported tensor/provenance audit](expert-export-roundtrip-candidate4.json)
  and [final tutorial native correction proof](tutorial-candidate4-native-correction-proof.json).
- [Machine-readable status](current-status.json) retains all candidate stages,
  including failed acceptance gates.
- [Independent focused runtime review](code-review-candidate4.json) found no
  blocker in the supported fixture, worker and off-map recovery contracts;
  it records certificate boundaries separately from execution evidence.

Earlier frozen candidates completed all missions but failed casewise PP
parity on genuinely reserved inputs: [fresh84](confirmation84-independent-audit.json)
had 4 regrets, [fresh100](confirmation100-v2-independent-audit.json) had 16,
and [fresh40](confirmation40-v3-independent-audit.json) had one tutorial
regret of two steps. Each failed block became known development data only
after its result was opened. C4 corrects that last known error; there is
**no new independent holdout claim** for C4.

A global motion-logit bias and a broader same-heading queue proposal were
rejected after introducing casewise regressions. No such runtime shortcut
is enabled. A new infrastructure, larger timetable range, different fault
distribution or stronger PP configuration needs a separate frozen paired
evaluation and may need its own specialist.

## Replay and use

From `backend/`, with normal development dependencies installed:

```bash
python -m lab.marl.evaluate_uc2_roam_runtime \
  --cases ../docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json \
  --output lab/runs/uc2-roam-runtime1472.json
```

The evaluator uses the actual registered policy and performs an uncached
post-step reference audit. Compare by infrastructure and departure offsets
against the published fixed PP rows. Model/source/fixture/input hashes make
a replay's identity explicit. The final evaluated runtime source is
`e1b293364ae9b4ccbe0a39741f7836c55643ac5e`; later documentation commits do
not change its backend tree. Offline fit provenance and archived scripts
are documented in [training/](training/README.md).

Rebuild and restart the app to load the new backend and model assets:

```bash
git fetch origin
git switch codex/pf-ch-rl-main
git pull --ff-only origin codex/pf-ch-rl-main
./start-demo.sh 8000 "" --rebuild
```

Open `http://127.0.0.1:8000/#/tour/uc2-rl-tutorial/start`, followed by
`uc2-rl-1` through `uc2-rl-4`. Tours run neural inference with ROAM;
serving does not start online training.

## Validation

Final C4 focused native/model/export/recovery checks: **33 passed**.
The preceding C3 full local backend suite passed **988 tests / 22 skipped**;
its slow tier passed **19 / 1 skipped** with `DIRECTOR_PARALLEL=0`, because
the existing Director RNN multiprocessing workers crash natively on this
macOS setup. The direct UC2 driver uses no Director worker.

The [final C4 Linux CI](https://github.com/flatland-association/flatland-ui-hub/actions/runs/43492086369)
passes **990 backend tests / 22 skipped**, **20 slow tests / 2 training-tier
skips**, frontend style/i18n gates and the production build. This includes
Linux parallel Director strategy comparison; there are no fatal worker
errors. See the [portable CI record](ci-candidate4.json).

The [real production-browser check](browser-candidate4.json) passes all five
native tours with **14/14 arrivals**, native fault observation and displayed
lateness **9 / 19 / 24 / 20 / 30**. Play/Pause/restart and owned-session
cleanup pass; there are no application/WebSocket errors or Director calls.
An external SBB icon's 403 is recorded separately.
