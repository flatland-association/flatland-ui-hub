# Delegation record: contributor setup for any AI tool

**Date:** 2026-09-25 · **Delegated to:** Claude Opus 5.5 (Claude Code desktop, one
session, Auto-fix on) · **Review:** Daniel · **Branch:** `explore_db` → PR
[#89](https://github.com/flatland-association/flatland-ui-hub/pull/89)

This is an archive record. The live description is
[`docs/plans/multi-agent-contributor-setup.md`](../plans/multi-agent-contributor-setup.md):
update that file, not this one, when tools or paths change. It is kept so we
can look back on how the work was delegated: what was asked and what was
built, which decisions the agent took by itself, and where it scoped up or
down.

Unlike the earlier records, there was no written brief. The work grew over
eight short prompts in one conversation, each building on the answer before.
The asks are therefore quoted as prompts rather than as one brief.

---

## The asks (verbatim, in order)

1. > Wie könnten wir die aktuelle Version so bauen, das sie bspw. agents.md nutzt
   > und so auch nicht claude nutzer schnell damit arbeiten können. Ziel ist
   > eigentlich ein Set Up zu haben bei denen Leute über Codex, Github Copilot,
   > Goose oder anders einfach schnell mitwirken können und die Sachen gemäss
   > Contirbute richtig bauen.
2. > Ja, mach Schritt 1 und 2. Warum nicht auch noch 3 und 4?
3. > ja pushe alles. kucke auch das die parallele session alles mitnimmt und mach
   > auch gleich ein PR gegenüber
4. > ja *(enable Auto-fix)*
5. > Und funktioniert das auch für kiro? was müsste man tun? *(followed by "ja" to do it)*
6. > ok, dann Cursor noch prüfen
7. > Ok und Mach vielleicht noch eine Anleitung und nimm es zu contribute, damit
   > die Leute starten können.
8. > aktualisiere noch die PR-Beschreibung von #89 · Archiviere die Entscheidungen
   > als Delegation-Dokument

---

## What the agent found first (before proposing)

- **`CLAUDE.md` held the context (180 lines), and `AGENTS.md` was a 21-line
  stub pointing back to it.** Every tool other than Claude got almost nothing.
- **There was no `CONTRIBUTING.md`.** "gemäss Contribute" could only mean the
  in-app `/contribute` page (six areas), so the guide was modelled on it.
- **The only skill (`create-widget`) was in `.claude/`, and `.claude/` was
  gitignored in full.** Nobody but its author had it, not even other Claude
  users.
- **CI checked build and pytest only.** `lint:styles` existed but did not run in
  CI. `i18n:coverage` was report-only by design.
- **Rules that existed only in Claude's private memory:** PR target
  `explore_db`, never merge `main`, never `reset --hard` in the shared tree,
  and keeping issues short.

The four-step proposal came out of this audit: (1) CI gates, (2) CONTRIBUTING
and a PR template, (3) AGENTS.md as the single source with nested files,
(4) tool-neutral skills and a setup for cloud agents. The agent suggested
doing 1+2 first "because they are small and reviewable". Daniel asked why not
all four. There was no substantive reason, so all four landed, one commit per
step.

## Decisions and why

**D1 — Enforce, then instruct.** Instruction files are only hints, and CI is
the actual bar, whichever tool wrote the code. So the colour gate went into CI,
along with a new `i18n:check` (`i18n-coverage.mjs --strict`).
- *Scoping call:* The i18n strategy allows partial de/fr on purpose, so the
  gate does **not** fail on missing translations. It fails only on errors that
  show up as broken UI: a literal key used in `src/` that is missing from
  `en.json`, and stale de/fr keys.
- It was verified in both directions: 0 findings on HEAD, and a planted
  missing key was caught.
- The gate flagged three hex fallbacks on the Contribute page. The agent fixed
  them in the same commit so CI would not be red on arrival.

**D2 — CI also runs on `explore_db`.** Before, PRs only triggered CI against
`main`, but contributors are told to target `explore_db`.

**D3 — `AGENTS.md` becomes the source and `CLAUDE.md` the pointer.**
`CLAUDE.md` is reduced to an `@AGENTS.md` import plus Claude-only notes. The
long AI4REALNET / flatland-association section moved verbatim to
`docs/reference/ecosystem.md` rather than being rewritten, to avoid losing
nuance. `copilot-instructions.md` keeps only the rules code review must not
miss, because Copilot code review reads that file.

**D4 — Nested `frontend/AGENTS.md` and `backend/AGENTS.md`.** Codex, Cursor and
Kiro take the nearest file, so the local rules sit where the code is. Facts
were checked against the tree before writing: the stylelint filename, the
`integration` pytest marker, the planners folder.

**D5 — Skills live in `.agents/skills/` and each tool gets a symlink when it
needs one.** Tool support was checked against the docs on 2026-09-25, not
from memory:

| Tool | Where it looks for skills | What we did |
|---|---|---|
| Codex, Copilot, Cursor, Goose | read `.agents/skills` directly | nothing needed |
| Claude Code | `.claude/skills` | symlink; `.gitignore` became `.claude/*` + `!.claude/skills` |
| Kiro | only `.kiro/skills` | symlink, added after ask 5 |

Kiro's own steering format (`.kiro/steering/`) was **deliberately not used**,
because it would be a second source for the same rules.

**D6 — Make the skill tool-neutral rather than fork it.** Claude-only tools
(inline visualiser, preview browser) became "if your tool can …", each with a
fallback. There is one skill text for all tools.

**D7 — Cloud agents can run the checks.** `scripts/setup-dev.sh` is idempotent,
takes `--runtime` for a light install, and honours `SETUP_NO_VENV=1`.
`copilot-setup-steps.yml` uses it. It was tested in a clean worktree before
committing and passed on GitHub on its first run, including torch.

**D8 — Protect the parallel session.** Another session had uncommitted work in
the same tree the whole time.
- Every commit staged explicit paths only. Other sessions' files were never
  touched, stashed or reset.
- On ask 3 ("parallele Session mitnehmen") the agent checked first: that
  session had meanwhile committed its own work itself, so nothing was left
  behind and nothing was committed on its behalf.

**D9 — Rebase instead of force.** `origin/explore_db` had been rebased
elsewhere (23 behind, 20 ahead).
- `git cherry` showed that 15 of the 20 local commits were already upstream
  under new hashes. Only 5 were new.
- The agent took a backup branch, rebased (git skipped the duplicates),
  resolved the one `.gitignore` conflict by keeping both rules
  (`CLAUDE.local.md` from upstream, the skills exception from us), and pushed
  without force.

**D10 — Update the open PR, don't open a new one.** "mach ein PR" could not be
done literally: #89 (`explore_db → main`) was already open, and GitHub allows
one open PR per branch pair.
- The push extended #89 and the description was amended.
- In ask 8 the description was rewritten to cover the whole PR, including the
  Zug-Weg/Olten work of other sessions that it had never mentioned.
- The **title was changed too**, which had not been asked for explicitly.

**D11 — Auto-fix on Copilot's review.** There were eight comments on code from
other sessions (tour, reflection, deep links).
- Five were fixed:
  - a safe decoder for `#/tour/%`, verified in the browser;
  - `aria-pressed` and accessible names in the reflection prompt and debrief;
  - a spec for the question draw and answer serialisation, with the pure
    functions exported to make it testable.
- Two were answered as "no change needed", because they pointed at an older
  commit where the German strings had since become i18n keys.
- All seven threads got a reply and were resolved.

**D12 — A guide plus a "Start here" block rather than a seventh area card.**
`docs/start-contributing.md` is a walkthrough (setup, per-tool start, first
prompts, what each check's failure means). CONTRIBUTING stays the rulebook.
The Contribute page stays English, because it is an internal tool per
conventions §5. Its GitHub links point to `main` and only resolve after #89
merges. That was accepted and noted in the PR.

## Asked vs. built

| Ask | Built | Beyond / short of the ask |
|---|---|---|
| Setup so Codex/Copilot/Goose users "build things right" | AGENTS.md ×3, CONTRIBUTING, PR template, CI gates, shared skills, setup script | **Beyond:** the CI gates. The agent argued that instructions alone would not make other tools "build it right". |
| Push + include the parallel session | pushed after rebase; parallel work was already committed by its owner | nothing committed on the other session's behalf |
| "mach ein PR" | extended existing #89 | literal ask impossible (one PR per branch pair) |
| Kiro | symlink + docs | steering files consciously skipped |
| Check Cursor | docs only, no code needed | flagged a possible duplicate listing of skills via `.claude/skills` |
| Guide in Contribute | guide + "Start here" block + CONTRIBUTING/index links | links resolve only after the merge |
| Update PR description | whole PR described | **Beyond:** title changed too |

## Patterns worth reflecting on

- **Audit before proposing paid off.** The two most consequential findings
  (the gitignored skill and the report-only i18n script) were invisible from
  the question and came from reading the tree.
- **"Why not 3 and 4?"** The agent's step-by-step caution was not grounded in a
  real risk. When asked, it said so and did everything. Proposing small steps
  by default is a habit worth questioning when the steps are cheap and
  independent.
- **Tool support was researched, not recalled.** Each tool's paths were checked
  in its docs at the time of writing and dated. Two claims had been hedged in
  the first proposal (Goose and AGENTS.md, skill paths), and both were resolved
  by the lookup before anything was built.
- **Literal asks that can't be met.** "Mach ein PR" and "nimm die parallele
  Session mit" were both answered by checking state first and then explaining
  why the literal action was unnecessary or impossible, not by forcing it.
- **Scope creep, small and visible.** The PR title change and the review fixes
  on other sessions' code went beyond the literal asks. The fixes were covered
  by the standing Auto-fix authorisation. The title change was reported
  afterwards rather than asked first.

## Commits

| Commit | Content |
|---|---|
| `660e34d` | ci: colour and i18n gates, CI on `explore_db` |
| `de782c2` | docs: CONTRIBUTING.md and PR template |
| `432a48f` | docs(agents): AGENTS.md as single source, nested files, ecosystem.md |
| `4016115` | feat(agents): `.agents/skills`, setup script, Copilot setup steps |
| `40ae8c5` | fix(tour): review feedback (safe deep links, a11y, reflection spec) |
| `8b7dde5` | feat(agents): Kiro |
| `0c23799` | docs(agents): Cursor checked |
| `f4173e5` | docs: start-contributing guide, Contribute "Start here" |

## Open at the time of archiving

- **Duplicate skills in Copilot/Cursor:** they may list `create-widget` twice
  (via `.agents/skills` and `.claude/skills`). This is untested in the tools
  themselves.
- **Tool starts untested:** the start commands for Codex, Cursor, Goose and Kiro
  come from their docs and were not run in each tool.
- **Not yet CI gates:** `ruff check` and `ng test`.
- **More skills:** candidates are `add-policy` and `add-translation`.
- **Local cleanup:** the backup branch `backup/explore_db-before-rebase-2026-09-25`
  can be deleted once #89 is merged.
