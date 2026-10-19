# Start contributing: a step-by-step guide

This guide takes you from nothing to your first pull request, whether you code
by hand or with an AI coding tool. The rules themselves are in
[`CONTRIBUTING.md`](../CONTRIBUTING.md). This page is the walkthrough.

> **Short on time?** Clone, run `scripts/setup-dev.sh`, open the repo in your
> tool, and ask it to *"read AGENTS.md and CONTRIBUTING.md, then …"*. Before
> opening a PR against `explore_db`, run the four checks in step 5.
>
> **Nothing installed locally?** See
> [Without a local install](#without-a-local-install): use a Codespace, a
> cloud agent, and your own Hugging Face preview.

## 0. Does your idea need code at all?

Three of the six contribution areas work entirely in the browser, with no
clone and no setup:

| You want to… | Use |
|---|---|
| draw a track network | Infrastructure Builder (`/infrastructure-builder`) |
| build a scenario | Infrastructure Builder + [scenario layers](plans/scenario-infrastructure-gallery.md) |
| arrange panels per mode | Layout Designer (`/designer`) |

Open the app, go to **Menu → Contribute**, and follow the card. You only need
the rest of this guide for **widgets, algorithms and surveys**, or for any
change to the code.

## 1. Get the code and set it up (about 10 minutes)

You need Python 3.12+, Node.js 22.22.3+ and git.

```bash
git clone https://github.com/flatland-association/flatland-ui-hub.git
cd flatland-ui-hub
git checkout explore_db
scripts/setup-dev.sh
```

`setup-dev.sh` creates `backend/.venv` and installs the backend and frontend
dependencies. It is safe to run again. If you only want to run the app and
not the tests, `scripts/setup-dev.sh --runtime` skips torch and pytest, which
saves a few GB.

Start the two servers in two terminals:

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm run start
```

Then open http://localhost:4200.

Windows: clone with `git clone -c core.symlinks=true …` so the skill links
work for Claude Code and Kiro.

## Without a local install

You can do everything in the browser.

**A. Work in a Codespace.** This gives you the full setup: editor, running
app and tests.

1. Fork the repo on GitHub.
2. On your fork, click **Code → Codespaces → Create codespace on
   `explore_db`**.
3. Wait for the setup to finish. The dev container runs `scripts/setup-dev.sh`
   on first start, which takes about 5–10 minutes.
4. Run the two servers in two terminals:
   ```bash
   cd backend && uvicorn app.main:app --reload --port 8000
   ```
   ```bash
   cd frontend && npm run start
   ```
5. Open the forwarded port **4200** (the *Ports* tab, "Frontend"). The app
   calls the backend through the dev-server proxy, so port 8000 does not
   need to be public.

Copilot is built into the Codespace editor. Codex CLI, Claude Code or Goose
can be installed in its terminal like on a laptop. Codespaces includes a free
monthly quota for personal accounts; beyond that, the account owner pays.

**B. Let a cloud agent do the work.** Claude Code on the web, Codex cloud,
the Copilot coding agent and Cursor's background agents all work on a branch
and open a PR (table in step 2). They cannot show you the running app, which
is what C is for.

**C. Your own preview on Hugging Face.** Every push to your fork, on any
branch, rebuilds your own Space:

1. On huggingface.co, create a Space: SDK **Docker**, template **Blank**,
   hardware **CPU basic**. ⚠️ Hugging Face requires a paid account plan (PRO or
   an organisation plan) to create a Space that runs a Docker container, even
   on the free CPU basic hardware.
2. Create a Hugging Face **write** token that can write to that Space.
3. In your fork on GitHub, go to *Settings → Secrets and variables → Actions*
   and add:
   - secret `HF_TOKEN`: the token
   - variable `HF_SPACE`: `<your-hf-user>/<space-name>`
4. On your fork's **Actions** tab, enable workflows. GitHub switches them off
   in new forks.
5. Push. *Deploy to Hugging Face Space* assembles and pushes the Space, and HF
   builds it in a few minutes. The Space title and the app's build info show
   which branch and commit it runs.

Put the Space link in your PR description so reviewers can try the change
without checking it out. Details on how the mirror works:
[`deploy-hugging-face-space.md`](deploy-hugging-face-space.md).

## 2. Open the repo in your tool

Every tool below reads [`AGENTS.md`](../AGENTS.md) automatically. It also
reads `frontend/AGENTS.md` or `backend/AGENTS.md` when you work in those
folders. You don't need to configure anything.

| Tool | How to start | Skills (e.g. `create-widget`) |
|---|---|---|
| **Codex** (CLI / IDE) | `codex` in the repo root | found in `.agents/skills/` |
| **Codex cloud** | Create an environment for the repo with setup script `SETUP_NO_VENV=1 scripts/setup-dev.sh` | found in `.agents/skills/` |
| **GitHub Copilot** (VS Code agent mode, CLI) | Open the folder, switch Chat to *Agent* | found in `.agents/skills/` |
| **Copilot coding agent** (on github.com) | Assign an issue to Copilot. `copilot-setup-steps.yml` prepares its sandbox | found in `.agents/skills/` |
| **Cursor** | Open the folder, use Agent | found in `.agents/skills/` |
| **Goose** | `goose session` in the repo root | found in `.agents/skills/` |
| **Kiro** | Open the folder | found via `.kiro/skills` (symlink) |
| **Claude Code** | `claude` in the repo root | found via `.claude/skills` (symlink) |
| **Anything else** | Tell it: *"Read AGENTS.md first and follow it."* | Point it at `.agents/skills/<name>/SKILL.md` |

## 3. Give it a good first task

Name the area and the result you want, and let the tool read the docs. Example
prompts that work well here:

- **New widget:** *"Use the create-widget skill. I want a panel that shows
  which trains miss their connection in the next 30 minutes. Start with the
  spec, don't write code yet."*
- **New algorithm:** *"Add a policy based on
  `backend/app/policies/templates/template_policy.py` that always lets the
  earlier-scheduled train go first. Register it and add a test."*
- **Translation:** *"The panel X still has German text in its template. Move
  every string to i18n keys in en/de/fr (Swiss German, informal du), then run
  npm run i18n:check."*
- **Colour cleanup:** *"Tokenise the hardcoded colours in
  `features/impact-panel/impact-panel.component.scss`, then remove the file
  from `LEGACY_DEBT` in `.stylelintrc.cjs` and run npm run lint:styles."*

For anything that changes how the modes behave, add: *"Read
docs/reference/interaction-modes-brief.md first."* For anything algorithmic,
add: *"Check docs/reference/ecosystem.md for a consortium implementation
before writing your own."*

## 4. Look at the result yourself

- **Run the app** and click through the change. For mode-dependent behaviour,
  check all three modes: *Recommendation*, *Co-Learning* and *Director*.
- **Read the diff.** The two most common mistakes tools make here are
  hardcoded colours and German or English text typed straight into a template.
- **Use the Widget Gallery** at `/widgets` to confirm a new widget shows up,
  in the right kind and with no "availability drift" warning.

## 5. Run the checks (the same ones as CI)

```bash
cd frontend && npm run lint:styles && npm run i18n:check && npx ng build --configuration production
```

```bash
cd backend && pytest -q -m "not integration"   # quick; CI runs the full suite
```

What a failure means:

| Check | Fails when | Fix |
|---|---|---|
| `lint:styles` | a raw hex colour or colour name is in SCSS | use a `--sbb-color-*` / `--app-*` token or `light-dark()`; a new colour means a new token in `styles.scss` |
| `i18n:check` | a key used in the code is missing from `en.json`, or de/fr have a key that en doesn't | add the key to `en.json` (and de/fr), or delete the stale one |
| build | a type or template error | read the first error, since the rest usually follow from it |
| pytest | a backend behaviour changed | fix the code, or update the test if the change was intended, and say so in the PR |

## 6. Open the pull request

```bash
git checkout -b feat/my-change
git add <the files you changed>        # not "git add -A" if other work is lying around
git commit -m "feat(scope): what it does"
git push -u origin feat/my-change
```

Open the PR **against `explore_db`**. If you have no write access, fork first
and push to your fork. The PR template holds the checklist. Fill in *How it was
built*: which tool helped and what you checked yourself. Attach a screenshot
for visible changes.

## When something goes wrong

- **The tool ignores the rules.** Check that you opened the repo root, not a
  subfolder above it. Then ask: *"Which instruction files did you load?"* If
  AGENTS.md is missing from its answer, tell it to read the file explicitly.
- **The tool wants to reset or clean the whole tree.** Say no. Other work may
  be uncommitted in the same checkout. Restore single files instead
  (`git restore <path>`).
- **`setup-dev.sh` fails on torch.** Use `--runtime` to run the app, and let CI
  run the full test suite.
- **A skill doesn't show up.** Some tools only list skills after a restart. You
  can always ask the tool to follow `.agents/skills/<name>/SKILL.md` by hand.
