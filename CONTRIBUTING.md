# Contributing

Thanks for helping move the Flatland Dispatcher forward. This page is the
checklist for getting a change merged. It applies the same way whether you
write the code yourself or with an AI coding tool (Codex, GitHub Copilot,
Goose, Kiro, Cursor, Claude, …). The project context those tools need lives in
[`AGENTS.md`](AGENTS.md), and most of them read it automatically.

## 1. Pick what you want to change

The running app has a **Contribute** page (menu → *Contribute*, route
`/contribute`) that lists the six areas and links to where each one starts:

| Area | Needs a dev environment? | Start here |
|---|---|---|
| Widgets (HMI panels) | yes | [`docs/reference/widget-authoring-process.md`](docs/reference/widget-authoring-process.md), skill [`create-widget`](.agents/skills/create-widget/SKILL.md) |
| Scenarios | no, in the browser | Infrastructure Builder (`/infrastructure-builder`), [`docs/plans/scenario-infrastructure-gallery.md`](docs/plans/scenario-infrastructure-gallery.md) |
| Infrastructure | no, in the browser | Infrastructure Builder, [`docs/infrastructure_builder/requirements.md`](docs/infrastructure_builder/requirements.md) |
| Layouts | no, in the browser | Layout Designer (`/designer`), [`docs/plans/layout-grid-model-plan.md`](docs/plans/layout-grid-model-plan.md) |
| Algorithms (policies) | yes | [`backend/app/policies/templates/template_policy.py`](backend/app/policies/templates/template_policy.py) → register in [`registry.py`](backend/app/policies/registry.py) |
| Surveys | yes | [`frontend/src/app/core/survey/survey-configs.ts`](frontend/src/app/core/survey/survey-configs.ts); check the validated [`AI4REALNET/hmisurveys`](https://github.com/AI4REALNET/hmisurveys) items first |

For anything that changes how the three interaction modes behave, read
[`docs/reference/interaction-modes-brief.md`](docs/reference/interaction-modes-brief.md)
first. Anything with an AI4REALNET or flatland-association reference
implementation should be **reused, not rebuilt**
([`docs/reference/ecosystem.md`](docs/reference/ecosystem.md)).

## 2. Set up

Python 3.12+ and Node.js 22.22.3+ are required.

```bash
scripts/setup-dev.sh        # installs backend (backend/.venv) + frontend deps, idempotent
```

Then run the two servers as in the [README quick start](README.md#quick-start),
or run `./start-demo.sh`, which builds everything and serves it on one port.

## 3. Branches and pull requests

- Branch off **`explore_db`** and open your PR **against `explore_db`**. That is
  the integration branch. `main` is merged from it by the maintainers, so
  don't target or merge `main` yourself.
- One topic per PR. Keep unrelated reformatting out of it.
- Commit messages follow `type(scope): summary`, e.g.
  `feat(zug-weg): route choice in the widget`, `fix(i18n): …`, `docs: …`.
  Common types: `feat`, `fix`, `docs`, `ci`, `refactor`, `test`.
- **Spec before code** for anything larger than a fix: put the reasoning in a
  plan under [`docs/plans/`](docs/plans/). Issues stay short: a summary,
  acceptance criteria, and a link to the plan.
- If a consortium repo names or shapes something differently than we do,
  follow the consortium convention and say so in the PR.

## 4. Definition of done

CI runs the first four checks on every PR, and they must be green. Run them
locally before you push:

```bash
cd frontend && npm run lint:styles     # no hardcoded colours
cd frontend && npm run i18n:check      # every translation key used exists in en.json
cd frontend && npx ng build --configuration production
cd backend && pytest -q                # needs requirements-dev.txt
```

CI can't check the rest, so the reviewer will:

- [ ] **No hardcoded colours.** Use Lyne tokens (`--sbb-color-*`), app tokens
      (`--app-*`, `--color-*`, `--layer-color-*`) or `light-dark()`. Never add a
      file to the stylelint `LEGACY_DEBT` list.
- [ ] **No inline user-facing text.** Every string in the start screen, tours,
      working screen, widgets and shell is a key in
      `frontend/public/i18n/{en,de,fr}.json`. English is the source. German uses
      Swiss spelling and the informal *du*. French drafts are fine but get
      flagged for a native reviewer. Logic compares ids, never labels.
- [ ] **Mode semantics** stay in the `InteractionMode` union, with no parallel
      flags. Mode-dependent behaviour is documented in
      [`panel-mode-matrix.md`](docs/reference/panel-mode-matrix.md).
- [ ] **New backend gating has tests** in `backend/tests/`.
- [ ] **Guardrail code is untouched** unless the PR is explicitly about it:
      trajectory compression (`_recordTrajectory`), scenario-refresh
      throttling, the `_recoverPolicyAndRetry*` fallbacks.
- [ ] **Visible changes** come with a screenshot in the PR.

The full frontend rules are in
[`docs/reference/frontend-lyne-conventions.md`](docs/reference/frontend-lyne-conventions.md).

## 5. Working with AI coding tools

Any tool is welcome, and every tool is held to the same bar.

- **Instructions:** [`AGENTS.md`](AGENTS.md) at the root, plus
  [`frontend/AGENTS.md`](frontend/AGENTS.md) and
  [`backend/AGENTS.md`](backend/AGENTS.md) for the rules of each part. Codex,
  Copilot, Cursor, Goose and Kiro read these on their own. Claude Code reads
  `CLAUDE.md`, which imports `AGENTS.md`. If your tool doesn't, point it at
  `AGENTS.md` yourself.
- **Skills:** [`.agents/skills/`](.agents/skills/) holds reusable workflows in
  the open `SKILL.md` format, for example `create-widget`. Codex, Copilot and
  Goose discover them there. Claude Code and Kiro find them via the symlinks
  `.claude/skills` and `.kiro/skills`.
- **You own the change.** Read the diff before you push, run the checks above,
  and describe in the PR what the tool did and what you verified.
- **Don't let a tool discard work it didn't create.** No `git reset --hard`,
  `git checkout .` or `git clean` over the whole tree. Other sessions, human
  or AI, may have uncommitted work in the same checkout. Restore single paths
  instead.
- **Archiving briefs is encouraged.** If you delegated a larger task, the
  prompt and the decisions can go under
  [`docs/delegation/`](docs/delegation/) as a dated file.

Rules for the instruction files themselves: `AGENTS.md` is the single source
for agents, and the conventions doc is the single source for frontend rules.
The tool-specific files (`CLAUDE.md`, `.github/copilot-instructions.md`)
only point to them. Change the source, not the pointers.
