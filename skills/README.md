# Shared Agent Skills

This directory is the canonical home for repository-local maintainer skills.
These skills are not public product documentation. They exist only when the
repository needs an AI-readable rubric that is not already captured by Deno
tasks, scripts, specs, or docs.

Both agent-specific paths point here:

```text
.claude/skills -> ../skills
.codex/skills  -> ../skills
```

Add new skills as `skills/<skill-name>/SKILL.md`. Keep instructions portable
unless a section is explicitly marked for one agent.

## Scope

Keep repository-local skills narrow and Anchr-specific:

- Issue bookkeeping: `make-issues`, `make-sub-issues`, and `resolve-issues`.
- Semantic checks that depend on Anchr architecture or trust boundaries:
  `arch-lint-llm` and `check-silent-bypass`.

Do not add a local skill for a command sequence already expressed by
`deno.json`, `scripts/`, or `CONTRIBUTING.md`. Add a skill only when a
recurring review finding needs judgment across files and cannot be reduced to a
deterministic check.

Use maintained gstack skills for generic planning, product review, engineering
review, design review, office-hours, or broad consultation workflows instead of
adding Anchr-local duplicates.
