# AGENTS.md

Project notes for Codex and other coding agents.

Read `CLAUDE.md` for the core project rules. This repository keeps the main
runtime, logging, type, test, lint, and layout guidance there so Claude and
Codex share one source of truth.

Current package, app, and example boundaries are documented in `CLAUDE.md` and
`docs/architecture.md`; keep agent-specific notes as pointers instead of
duplicating the layout rules here.

## Shared skills

- Canonical skill definitions live in `skills/<skill-name>/SKILL.md`.
- `.claude/skills` and `.codex/skills` must remain symlinks to `../skills`.
- Add or edit skills under `skills/` only. Do not create divergent copies under
  agent-specific directories.
- Keep `SKILL.md` content portable by default. If a skill needs Claude-only or
  Codex-only behavior, label that section explicitly.
- When a request matches an available skill, use that skill first. If the
  current agent does not expose the skill runner directly, follow the relevant
  `skills/<skill-name>/SKILL.md` manually.
