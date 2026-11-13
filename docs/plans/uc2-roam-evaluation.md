# UC2 ROAM inference ablation

## Objective and frozen control

Check whether the existing UC2 neural driver can reach 50/50 complete missions
on the historical final50 cases when the existing ROAM checker is added at
inference. This is a diagnostic/regression comparison on an already inspected
benchmark, not a new blind generalisation result. Do not change weights, native
fixtures, faults, train speeds, deadlines or episode limits. Keep the published
runtime and PR196 unchanged while testing in this isolated branch.

Frozen source: e6937e18af95ab399635cd42eb6ada79599c7951. Runtime checkpoint SHA256:
01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668.
Existing published models and results remain unchanged.

## Reuse decision

Use the project's existing MIT Flatland implementation from
`ecml2026-starterkit/submission/roam_check.py`, source commit
ccbcf3de22fb7daa8276948e37819a904aac550e. Its algorithm is the original requested
ROAM: Reserve Only if All Missions stay achievable. It uses native successor
configurations/resources, a relative stuck-after subset criterion, optional
bounded partial moves and native MotionCheck action withdrawal. Do not copy
rayl/dbbsim code, invent a new solver or install dependencies. Adapt only where
native4.3 behaviour or the hub observation interfaces require it; record changes
and source hashes. Serial certificates are sufficient, not necessary. They do
not ensure that a policy chooses progress or finishes before a deadline.

## Predeclared variants

- V0: current313-feature frozen network and its native legal/state mask.
- V1: same 313feature values and network; intersect the appended mask with ROAM
  serial-completion safety masks, then apply joint withdrawal before env.step.
- V2: V1 with the existing partial_moves option enabled, max_candidates 60.

Start with correctness tests and the two recorded failures, then compare all
variants on exact5, development20 and historical final50. Report every case,
including technical failures and regressions. No PP/DLA planning fallback,
movement-forcing or fresh training belongs to V1/V2. If further repair rules are
explored, label them as separate variants selected after benchmark inspection.

## New files

| File | Purpose |
|---|---|
| backend/lab/marl/roam_check.py | Existing reusable MIT ROAM core, provenance recorded |
| backend/lab/marl/LICENSE.roam-starterkit | Preserve reference licence |
| backend/lab/marl/evaluate_uc2_roam.py | Frozen-policy mask/withdrawal wrapper and paired native evaluation |
| backend/tests/test_uc2_roam_check.py | Graph expectations, native4.3 predictor and integration regressions |
| backend/tests/test_uc2_roam_evaluation.py | Frozen-network end-to-end regression checks |
| docs/examples/uc2-roam/ | Portable input/weight/source hashes and per-case outcomes |

No application, frontend or checkpoint modifications are planned. This document
is the experiment plan and later report.

## Correctness and measurements

Verify ordered targets, grade-separated resources, off-map admission, nonempty
fallbacks, independently-safe/jointly-unsafe proposals, fractional 0.6 movement,
known malfunction/recovery and predicted-vs-actual MotionCheck results. The hub
builder's mission tracker is authoritative; do not add a second waypoint tracker.
Audit actual post-step stuck sets and resource uniqueness against the native
state, with known post-step faults recorded separately. Check simulation input
hashes and checkpoint identity before/after each run.

Report complete missions, arrivals, summed native lateness/reward, physical
stops, mask changes and action withdrawals, long stationary tails, certificate
failures, preparation time and step/policy/checker latency. Measure correctness
before timing; keep instrumentation overhead explicit. A safe STOP can still
produce starvation, and no formal universal safety guarantee is claimed.

## Result

Both V1 and V2 reach 50/50 complete missions (140/140 trains) on historical50
and on a new confirmation50 manifest frozen before outcomes. V0 reproduces
48/50 historical cases and reaches 49/50 on the new ones. V2 lateness is
1139/1117 versus V0 1607/1592 and PP 1316/1299 respectively. All five original
demos remain complete, with V2 summed lateness 117 versus V0 121. Some individual
cases become later; the configured sufficient certificates remain intact in
all observed guarded states.

The [full report](../examples/uc2-roam/README.md) contains source/input hashes,
casewise outcomes, audits, all tradeoffs and reproduction commands. Source
commit dd2724d2 is frozen for these comparisons; checkpoint, app/frontend and
published PR196 remain unchanged. Integration into the visible demo is a
separate next step, not performed by this offline evaluation.
