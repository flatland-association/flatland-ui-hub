# Multi-agent contributor setup — any AI tool, one bar

> Decided and built 2026-09-25. Goal: people using Codex, GitHub Copilot,
> Goose, Kiro, Cursor or Claude can contribute quickly and still build things
> according to [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
>
> How it was delegated and decided, step by step:
> [`docs/delegation/2026-09-25-multi-agent-contributor-setup-claude.md`](../delegation/2026-09-25-multi-agent-contributor-setup-claude.md).

## Problem

The project context lived in `CLAUDE.md` (180 lines), and `AGENTS.md` was a
20-line stub that pointed back to it. The other tools read `AGENTS.md`, so they
got a fraction of the rules. The branch target, the definition of done and the
rule against discarding other sessions' work were written down nowhere except
Claude's private memory. The only skill (`create-widget`) sat in the gitignored
`.claude/` folder, so nobody else had it. CI checked build and tests but not
the two conventions agents miss most often (colours, i18n keys).

## Decisions

1. **Enforce, then instruct.** Instruction files are hints, and CI is the
   actual bar. The frontend job now runs `npm run lint:styles` and the new
   `npm run i18n:check`. That check fails on literal keys used in `src/` that
   are missing from `en.json`, and on stale de/fr keys. Partial de/fr coverage
   stays allowed, per [`i18n-strategy.md`](i18n-strategy.md). CI also runs for
   PRs against `explore_db`.
2. **`CONTRIBUTING.md` is for people, `AGENTS.md` is for tools, and both carry
   the same bar.** CONTRIBUTING mirrors the in-app `/contribute` page (six
   areas) and adds branches, commit style, the definition of done and a
   section on AI tools. A PR template repeats the checklist.
3. **`AGENTS.md` is the single source.** `CLAUDE.md` imports it with
   `@AGENTS.md`. `.github/copilot-instructions.md` keeps only the rules code
   review must not miss. The long consortium and upstream reference moved
   verbatim to [`docs/reference/ecosystem.md`](../reference/ecosystem.md).
4. **Nested `frontend/AGENTS.md` and `backend/AGENTS.md`.** Tools that read the
   nearest file get the local rules where the code is.
5. **Skills live in `.agents/skills/`.** As of 2026-09 this is the project
   skill location that Codex, the Copilot tools and Goose all scan.
   `.claude/skills` is a tracked symlink to it (`.gitignore` now ignores
   `.claude/*` except `skills`). The skill text is tool-neutral: Claude-only
   tools such as the inline visualizer and the preview browser are named as
   "if your tool can", with a fallback.
6. **Cloud sandboxes can run the checks.** `scripts/setup-dev.sh` installs the
   dependencies and is idempotent. It is used by
   `.github/workflows/copilot-setup-steps.yml` (Copilot coding agent) and can
   be the setup script of a Codex cloud environment.

## Tool support this relies on (checked 2026-09-25)

| Tool | Instructions | Skills |
|---|---|---|
| Codex | `AGENTS.md`, nested, nearest wins | `.agents/skills` in each dir up to the repo root |
| GitHub Copilot (cloud agent, CLI, VS Code) | `AGENTS.md`, `.github/copilot-instructions.md` | `.github/skills`, `.claude/skills`, `.agents/skills` |
| Cursor | `AGENTS.md`, nested (more specific wins, parents still apply) | `.agents/skills`, `.cursor/skills`; also `.claude/skills` and `.codex/skills` for compatibility |
| Goose | `AGENTS.md`, `.goosehints` (default context files) | `.agents/skills` |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/skills` (symlink) |
| Kiro (IDE ≥ 1.0.309, CLI ≥ 2.18.0) | `AGENTS.md` anywhere in the tree, always included; `.kiro/steering/` not used | `.kiro/skills` only (symlink, added 2026-09-25) |

This changes quickly, so re-check the table when a tool stops picking
something up.

## Open

- **Windows clones** need `core.symlinks=true` for the `.claude/skills` and
  `.kiro/skills` symlinks. Without it, Claude and Kiro users on Windows see a text file instead of the
  skills. Other tools aren't affected.
- **Same skill seen twice?** Copilot and Cursor scan both `.agents/skills` and
  `.claude/skills`, so via the symlink they reach `create-widget` twice. Neither
  tool documents how it handles duplicate names (checked 2026-09-25). If one
  lists the skill twice, that's harmless but could be tidied up.
- **More skills.** Candidates are `add-policy` (template → registry → gallery)
  and `add-translation` (en/de/fr + check).
- **`ruff check` and `ng test`** are still not CI gates (see the header of
  `ci.yml`).
