# Widget spec — Optimization Monitor (`optimization-monitor`)

## 1. Identity
- **Name:** Optimization Monitor (Optimierungs-Monitor)
- **`kind`:** trust
- **`granularity`:** overview
- **Default zone:** right (supervision, read-only)
- **Panel `type`:** `optimization-monitor`
- **Catalog id:** new
- **Source(s):** [D3.1] §7 (Director System), [DB]
- **Grounding reference:** control-room practice with an automatic planner: the
  dispatcher has to know at a glance whether the planner currently has a
  solution, how good it is, since when, where it struggles and how far ahead it
  looks — and what it cannot see at all. Without that, supervision of an
  autonomous plan is guesswork (calibrated trust, Q2).
- **Source origin:** from-scratch, deliberately, as presentation only. All data
  comes from the existing goal-directed planner via `/director/activity` and
  `/director/progress`; no new algorithm.

## 2. Promise
> See whether the AI plan is a real searched solution, a fallback or none — since
> when, where it is stuck, how far ahead it plans, and where its model ends.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** not offered — no autonomous plan drives the run.
- **Co-Learning (WP 3.3):** not offered — same reason.
- **Director (WP 3.4):** the status card for the autonomous plan.

The widget never says "optimal". The planner does not prove optimality; it
searches. Status is one of:

| Status | Derived from |
|---|---|
| planning | `/director/progress.phase` ≠ `idle` |
| searched plan | `activity.source` = `search` |
| fallback plan | `source` ∈ `lines`, `avoidance`, `avoidance (no models)` |
| no route | `source` = `unroutable` |
| no plan yet | `source` = null |

Plus: **since step** (last re-plan that replaced the plan, else start),
**where** (trains whose planned decision has no branch — `stuck` — and the
reason of the last re-plan), **horizon** (last scheduled decision − now, in
steps), counts (decisions, re-plans) and the **model limits** as a fixed list.

## 4. System interaction
- **Data in:** `ApiService.getDirectorActivity(sid, 50)`, `getDirectorProgress(sid)`
  (polled every 2.5 s, like `ai-activity`), `SessionStore.session()`,
  `TrainIdentityService` for names.
- **Actions out:** `store.toggleAgentSelection(handle)` on a stuck train (navigation).

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Plan source / provenance | ✓ | |
| Since when (re-plan step) | ✓ | |
| Stuck trains | ✓ | |
| Horizon | ✓ (from scheduled decisions) | |
| Optimality gap / bound | | ✓ (flagged: planner reports none — not faked) |
| Model limits per scenario | | ✓ (flagged: static list today) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context (supervision)
- **Owner per mode:** Director — AI plans, human supervises.
- **Decision events emitted:** none.

## 6. Acceptance scenario
> Director, a malfunction hits. The planner re-plans; the status goes from
> "searched plan since step 0" to "searched plan since step N", or to
> "plan kept — alternative rejected". A train without a branch appears under
> "where". Success: the participant can say whether the AI currently has a real
> plan and which train it struggles with (Q2 calibrated trust).

## 7. Effort & changes
- **Effort:** S
- **Files:** `features/optimization-monitor/*`, the registration seams, i18n `optMon.*`.

## 8. Open questions / risks
- "Searched" is not "good". A quality figure (gap to a bound) needs the planner
  to report one — flagged, not faked.
- Model limits are a static list; a per-scenario list would need the backend.
