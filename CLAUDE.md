# CLAUDE.md

The project instructions for every AI tool live in **`AGENTS.md`**, imported
below. Edit that file, not this one, so Codex, Copilot, Goose, Cursor and
Claude Code all read the same rules. The same applies to `frontend/AGENTS.md`
and `backend/AGENTS.md`: read them when working in those folders.

@AGENTS.md

## Claude Code specifics

- Skills: `.claude/skills` is a symlink to `.agents/skills/`, which is shared
  with the other tools. Add new skills under `.agents/skills/`.
- For visible changes, verify in the browser preview (`.claude/launch.json`,
  which is local and gitignored) and not only with `ng build`.
- Consortium and upstream references (AI4REALNET, flatland-association, D3.1
  and D3.2) are in `docs/reference/ecosystem.md`.
