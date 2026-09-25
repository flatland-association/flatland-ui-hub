# AGENTS.md — Flatland Dispatcher (Human-AI Teaming Playground)

The single instruction file for every AI coding tool: Codex, GitHub Copilot,
Goose, Cursor, Claude Code (via `CLAUDE.md`, which imports this file) and
others. Humans start at [`CONTRIBUTING.md`](CONTRIBUTING.md). Both say the
same thing, so follow either.

More specific rules sit next to the code: [`frontend/AGENTS.md`](frontend/AGENTS.md)
and [`backend/AGENTS.md`](backend/AGENTS.md). The nearest file applies on top
of this one.

## What this repo is

A modular HMI for interactive railway-dispatching experiments, part of
**AI4REALNET** (EU Horizon).

- `frontend/`: Angular (standalone components + signals) with SBB Lyne web components
- `backend/`: FastAPI + Flatland-RL

It is **not** React, `lyne-react` or Tailwind, so ignore advice aimed at those.
Architecture: [`docs/reference/architecture.md`](docs/reference/architecture.md).
Doc index: [`docs/README.md`](docs/README.md).

## Commands

```bash
scripts/setup-dev.sh                          # install backend + frontend deps (idempotent)
cd backend && uvicorn app.main:app --reload --port 8000
cd frontend && npm run start                  # http://localhost:4200, proxies to :8000
./start-demo.sh                               # build + serve everything on :8000
```

Checks. CI runs all four and every PR must pass them:

```bash
cd frontend && npm run lint:styles            # no hardcoded colours
cd frontend && npm run i18n:check             # translation keys used in src/ exist in en.json
cd frontend && npx ng build --configuration production
cd backend && pytest -q                       # needs requirements-dev.txt
```

## Current focus — three human-AI interaction modes

The three collaboration modes have to be **behaviourally distinct and
switchable**:

- `recommendation` → WP 3.1. The AI suggests **with** a recommendation, the human decides.
- `co-learning` → WP 3.3. The AI offers **neutral** options. The human decides, reflects and simulates what-ifs.
- `director` → WP 3.4. The AI runs autonomously on high-level directives and the human supervises (**adjustable autonomy**).

**Read [`docs/reference/interaction-modes-brief.md`](docs/reference/interaction-modes-brief.md)
before touching mode behaviour.** It is the authoritative spec. It maps the
consortium-validated interaction flows onto files and signals here
(`SessionStore.interactionMode`, `recommendations-panel`, `agent-inspector`,
`co-learning-reflection`, `setOverride`, `conflict_detector`, …), lists what
exists and what is missing, and has the do-not-touch list. Per-panel mode
behaviour: [`docs/reference/panel-mode-matrix.md`](docs/reference/panel-mode-matrix.md).

## Reuse, don't reinvent

Before building a capability, check the consortium and upstream code in
**[`docs/reference/ecosystem.md`](docs/reference/ecosystem.md)**, and align
naming and semantics with it. In short:

- **AI4REALNET org** is the reference for algorithms and interaction
  concepts:
  - Tokener / T3.4-with-HMI for the Director
  - `agent-as-a-service-trace-rl` (A3S/TraceRL) for what-if compare
  - `RL_agent_failure_forecast` for uncertainty
  - T2.3 for explaining action alternatives
  - `hmisurveys` for validated survey items
  - `flatland-blackbox` for the CBS/PP solver
- **flatland-association org** is the reference for the environment,
  scenarios and timetables (`flatland-scenarios` JSON format), the sibling
  HMI `flatland-hmi`, and the WP4 KPIs. The AI4REALNET forks of these are
  stale, so always read the flatland-association originals.
- **Check the installed `flatland-rl` first.** Trajectory forking, targeted
  malfunctions and multi-objective rewards already exist.
- **Building our own algorithm is the exception.** Do it only as an explicit,
  written decision (e.g. in the widget spec's open questions), never by
  omission. Presentation and HMI framing stay ours.
- **If a consortium repo names something differently**, follow the consortium
  and note the divergence in the PR.

## Guardrails

The full list is in brief §6.

- **Keep mode semantics in the `InteractionMode` union.** No parallel flags.
- **Leave these alone:** trajectory compression
  (`session.store.ts _recordTrajectory`), the scenario-refresh throttling in
  `scenario-panel`, and the `_recoverPolicyAndRetry*` fallbacks.
- **Policy is global per session.** Per-agent policy doesn't exist yet
  (brief §4.4), so don't assume it.
- **Keep the stack.** Frontend stays Angular standalone + signals + SBB Lyne,
  backend stays FastAPI + Flatland. Gate presentation in the frontend rather
  than reshaping payloads.
- **No hardcoded colours.** Never write raw hex, `rgb()` or `rgba()` in SCSS
  or templates.
  - Use Lyne tokens (`--sbb-color-*`), the app tokens in
    `frontend/src/styles.scss` (`--app-*`, `--color-*`, `--layer-color-*`) or
    `light-dark(a, b)`.
  - A new colour means a new token. Agent colours stay in `AgentColorService`.
  - Existing hardcoded colours are legacy debt: don't add to them, migrate
    them when you touch a file.
- **No inline user-facing text.** Every string in the start screen, tours,
  working screen, widgets and shell is a key in
  `frontend/public/i18n/{en,de,fr}.json`.
  - English is the source and the fallback.
  - Logic compares ids, never displayed labels.
  - German uses Swiss spelling and the informal *du*. French drafts need a
    native reviewer.
  - Internal tools and questionnaires stay English.
- **Keep `backend/tests/` green** and add tests for new backend gating.

The full frontend rules are in
[`docs/reference/frontend-lyne-conventions.md`](docs/reference/frontend-lyne-conventions.md).

## How to work here

- **Branch off `explore_db` and open PRs against it.** Never target or merge
  `main`. Commits use `type(scope): summary`, e.g. `feat(zug-weg): …`.
- **Write the spec before the code** for anything larger than a fix, as a plan
  in `docs/plans/`. Issues stay short: a summary, acceptance criteria and a
  link to the plan.
- **Never discard work you didn't create.** Other humans or agents may have
  uncommitted changes in the same checkout. No `git reset --hard`,
  `git checkout .`, `git clean` or `git stash` over the whole tree. Restore
  single paths, and stage only the files you changed.
- **Skills** live in [`.agents/skills/`](.agents/skills/) (open `SKILL.md`
  format). Use `create-widget` for any new widget or panel. If your tool
  can't load skills, read the `SKILL.md` and follow it by hand.
- **Verify in the running app** for anything visible, not just with the build.

## Consortium deliverables

D3.1 (§7 Director System, §3 A3S/TraceRL audit trail) and D3.2 (WP3 code per
task) are public at https://ai4realnet.eu/deliverables/. Read them before
designing Director or logging work. There is a summary in
[`docs/reference/ecosystem.md`](docs/reference/ecosystem.md#consortium-deliverables--d31-and-d32-are-public-checked-2026-08-19).

## Keeping the instruction files in sync

This file is the single source for agents. The conventions doc is the single
source for frontend rules. `CLAUDE.md` and `.github/copilot-instructions.md`
only point here, so edit the source, not the pointers.
