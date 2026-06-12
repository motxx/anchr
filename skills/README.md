# Shared Agent Skills

This directory is the canonical home for repository-local maintainer skills.
They exist only when the repository needs an AI-readable judgment rubric that
cannot be reduced to a Deno task, script, spec, or doc.

Both agent-specific paths point here:

```text
.claude/skills -> ../skills
.codex/skills  -> ../skills
```

Add new skills as `skills/<skill-name>/SKILL.md`. Keep instructions portable
unless a section is explicitly marked for one agent.

## Current skills

- `make-issues` — create `docs/issues/pending/` entries, including child
  issues that split a broad parent.
- `resolve-issues` — implement, verify, and close pending issues with
  resolution notes.
- `arch-lint-llm` — semantic architecture review that `deno task lint:arch`
  cannot express; backed by the pre-ship hook
  `scripts/arch-lint-llm-verify.ts`.
- `check-silent-bypass` — semantic trust-boundary bypass review; backed by
  the pre-ship hook `scripts/silent-bypass-verify.ts`.

## Authoring rules

- A skill owns judgment: rubrics, decision heuristics, and workflow
  discipline. Repository facts that another file already owns — issue format
  (`docs/issues/README.md`), deterministic lint rules (`scripts/arch-lint.ts`),
  task definitions (`deno.json`), harness routing (`docs/review-harness.md`) —
  are referenced, never duplicated. Duplicated facts drift.
- Do not add a skill for a command sequence already expressed by `deno.json`,
  `scripts/`, or `CONTRIBUTING.md`. Add one only when a recurring review
  finding needs judgment across files and cannot become a deterministic check.
- Each skill does one thing; state its owner responsibility in one sentence
  before adding it.
- Use maintained gstack skills for generic planning, product review,
  engineering review, design review, or consultation workflows instead of
  adding local duplicates.
