# Ecosystem — consortium and upstream code to reuse

Moved out of `CLAUDE.md` (2026-09-25) so every contributor and every AI tool
reads the same reference. [`AGENTS.md`](../../AGENTS.md) and
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) point here. The rule it backs:
**reuse, don't reinvent.** Check these repos before building a capability, and
align naming and semantics with them.

## AI4REALNET reference implementations
Before reinventing behaviour, check the consortium reference implementations on
the **`AI4REALNET` GitHub org** and align naming/semantics with them:

- **Director / high-level directives (T3.4) — PP/CBS planner:** for the
  PP/CBS planner (brief §4.2b; see `recommender-roadmap.md`'s
  PP-replan-recommender item), the reuse target is `flatland-blackbox`
  directly — see below. Already vendored into `backend/app/planners/blackbox/`
  and used by `replan.py`.
- **What-if analysis (T3.1, EnliteAI A3S / TraceRL):**
  [`AI4REALNET/agent-as-a-service-trace-rl`](https://github.com/AI4REALNET/agent-as-a-service-trace-rl) —
  confirmed: a Redis-backed service that restores/simulates-forward/reports
  action spaces (Flatland-configured already), plus a Dash tree-visualisation
  app for branching trajectories (override → alternative future). **Convention:
  human-influenced steps = blue, AI-simulated steps = yellow.** Reuse for our
  Co-Learning compare (brief §3.3) and widget B1 (`widget-catalog.md`); the
  colour convention is already adopted (`--app-whatif-human`/`--app-whatif-ai`
  in `styles.scss`, used across `whatif-compare`, `proposal-compare`,
  `marey-chart`, `flatland-map`, `director-weights`).
- **Explaining action alternatives (T2.3, D2.3):**
  [`AI4REALNET/T2.3_explaining_action_alternatives`](https://github.com/AI4REALNET/T2.3_explaining_action_alternatives) —
  generates accurate *expected-outcome* explanations per action alternative
  without assuming the operator's reward weights. This is the concrete
  AI4REALNET grounding for our **Assessment** framing (Evaluative AI,
  `interaction-framework.md` §2) — the reuse target for widget C1.
- **Validated HMI surveys (Q5 study instruments):**
  [`AI4REALNET/hmisurveys`](https://github.com/AI4REALNET/hmisurveys) (TU Delft) —
  a modular, **validated** human-factors/cognitive-engineering survey framework
  for human-AI teaming, standalone HTML + JSON export. Check this before
  writing new survey questions from scratch (`features/survey/`,
  `core/survey/survey-configs.ts`); it's an instrument, not an algorithm, but
  the same "don't reinvent" rule applies — validated items beat home-grown ones
  for a study.

If a referenced repo's API or naming differs from this repo, prefer the
consortium convention and note the divergence in the PR.

⚠️ **The AI4REALNET org mirrors six `flatland-association` repos as forks that
are months stale** (`flatland-rl`, `flatland-book`, `flatland-scenarios`,
`flatland-baselines`, `ai4realnet-orchestrators`,
`flatland-benchmarks-f3-starterkit` — last pushed 2025-09-30 … 2026-02-03).
Always read those from `flatland-association`, never from the AI4REALNET mirror.

[`flatland-blackbox`](https://github.com/AI4REALNET/flatland-blackbox) is the
**canonical CBS/PP solver source** (it has a test suite and a `pyproject.toml`)
— already vendored, see above.

## Two upstreams, not one — know which is authoritative for what

AI4REALNET is **not** the reference for everything Flatland-shaped. For the
environment itself, scenarios, timetables and the scenario tooling, the
authority is the
[**`flatland-association`**](https://github.com/orgs/flatland-association/repositories)
org (MIT, actively maintained, it runs Flatland):

- **Scenarios / timetables / the drawing tool:**
  [`flatland-scenarios`](https://github.com/flatland-association/flatland-scenarios)
  — `scenario_generator/flatland_environment_drawing_tool.html` plus
  `model/scenario.py` (`to_rail_env()`, `ScenarioBuilder`). Its JSON keys
  (`gridDimensions`, `grid`, `overpasses`, `stations`, `lines`, `timetables`,
  `trainCategories`, `flatlandLine`, `flatlandTimetable`) are the format to
  target. ⚠️ The drawing board found in the AI4REALNET HMI repos is an older
  **fork** of this tool using the vocabulary Flatland 3 deprecated
  ("Schedule"/"Train Class" instead of "Timetable"/"Train Category") — do not
  align to it. Also here: **Olten**, a real Swiss network with lat/lon mapping
  in three disruption variants.
- **Sibling HMI with our exact stack:**
  [`flatland-hmi`](https://github.com/flatland-association/flatland-hmi) —
  Angular + FastAPI + Flatland-RL, MIT. Source for the Link Map / ZWL port
  (widget B4) and a working reference for trajectory fork/step endpoints.
  ⚠️ Its npm package `@flatland-association/flatland-ui` is **identity/branding
  components only** (Angular 20 + Tailwind) — not a widget library, not adopted.
- **WP4 validation campaign:**
  [`ai4realnet-orchestrators`](https://github.com/flatland-association/ai4realnet-orchestrators)
  — the five railway KPIs (AF-029, AF-051, NF-045, PF-026, RS-058) and the
  interactive-loop runner live here, not in the AI4REALNET org.

**Check the installed `flatland-rl` before planning to build a capability.**
Trajectory forking, targeted malfunction injection and multi-objective rewards
are already in the version we pin. Full survey, per-item plan and the version
delta: [`docs/plans/flatland-ecosystem-reuse-plan.md`](../plans/flatland-ecosystem-reuse-plan.md).

**Reuse, don't reinvent, the algorithms.** For anything with an AI4REALNET
reference implementation — e.g. **`agent-as-a-service-trace-rl`** (A3S/TraceRL)
for what-if/branch-compare (widget B1), **`RL_agent_failure_forecast`** (INESC,
evidential NN) for uncertainty/calibration (widget A1,
`docs/plans/widget-a1-risk-uncertainty.md` — do not conflate this with A3S, they
are two different repos for two different widgets), or `flatland-blackbox`
for the PP/CBS planner — integrate the consortium's code/approach by default.
Building our own algorithm from scratch is the exception, not the default: only
do it as an explicit, stated decision (e.g. in the widget spec's Open
questions/risks section), not by omission. This applies to the algorithms
themselves (UQ, calibration, policy negotiation, …); presentation/HMI framing
around them stays ours.


## Consortium deliverables — D3.1 and D3.2 are public (checked 2026-08-19)

Both are downloadable from https://ai4realnet.eu/deliverables/ (status: draft,
pending approval). Read them before designing Director or logging work:

- **D3.1** (TU Delft, 136 pp.) — §7 is the official **Director System**: the
  operator issues high-level *directives* executed by **interpretable
  primitives** derived from Hierarchical Task Analysis (Dettling et al. 2026),
  with a worked disruption-management example ("search suitable trains for
  rerouting" → identify / filter by capacity / filter direct-to-destination →
  ranked shortlist). §3 covers A3S + TraceRL and their "structured audit trail
  of operator decisions, AI recommendations and uncertainty estimates". The
  norm for logging is stated outright: trustworthy autonomy requires
  "structured, traceable decision records".
- **D3.2** (93 pp., slide deck) — documents the WP3 code per task with repo
  links; A3S is the named home for "auditing, logging and what-if analysis".
