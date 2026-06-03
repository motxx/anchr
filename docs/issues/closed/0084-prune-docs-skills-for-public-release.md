# Prune docs skills for public release

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-06-03

## Priority

maintenance

## Dependencies

Depends on:
- 0082

Blocks:
- 0080
- 0085

## Summary

Prune or internalize documentation and skills that are useful for maintainers
but noisy for external readers. Keep issue-driven and skill-driven development
available, while ensuring the public-facing docs emphasize the current product
contract rather than agent work history.

## Rationale

`docs/issues/`, repository-local skills, review harness notes, archived design
material, and agent workflow documents can be valuable for future development.
They can also make an external reader see internal process before the SDK and
protocol. The cleanup should keep only documents and skills whose need follows
directly from Anchr's SDK, protocol, security, verification, or issue workflow.

For human-in-the-loop planning, product review, engineering review, design
review, and office-hours style reconsideration, prefer the maintained gstack
skills instead of growing Anchr-specific duplicates. Repository-local skills
should stay narrow: file-based issue bookkeeping and project-specific semantic
checks that Deno tasks, scripts, specs, or docs do not already own.

## Acceptance

- Public-facing docs are identified and reachable from the README or package
  READMEs.
- Maintainer-only docs and skills are either moved under an internal/maintainer
  location, clearly labeled as maintainer workflow, or left unlinked from the
  public docs index.
- Unused or obsolete skills identified by #0082 are deleted only when no
  current workflow references them.
- Repository-local skills are reduced to the minimum Anchr-specific set needed
  for issue bookkeeping, project verification, and semantic checks; generic
  planning/review workflows are routed to gstack skills instead.
- `.claude/skills` and `.codex/skills` remain symlinks to `../skills` unless
  the repository's shared-skill policy is explicitly changed.
- `docs/issues/` remains usable as an internal maintenance queue or is moved
  with its issue tooling updated in the same coherent change.

## Verification

- `test -L .claude/skills && test -L .codex/skills`
- `rg -n "docs/issues|skills/" README.md packages/*/README.md docs/architecture.md docs/README.md`
- `deno task lint:strict`
- Manual check: public docs introduce Anchr through SDK/protocol concepts before
  maintainer issue or agent workflow material.

## Plan

- Use the #0082 inventory to separate public docs from maintainer docs.
- Identify local skills that duplicate gstack planning, office-hours, product,
  engineering, or design review workflows, and delete or simplify them.
- Prefer relabeling or internalizing useful workflow docs over deleting them.
- Delete only skills and docs that are obsolete, duplicated, or tied solely to
  removed repository surfaces.

## Resolution

Implemented by updating:

- `README.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/resilience-checklist.md`
- `docs/review-harness.md`
- `skills/README.md`
- `skills/arch-lint-llm/SKILL.md`

Removed noisy docs:

- `docs/development-publishing-strategy.md`
- `docs/blossom-nip23-blog-publishing.md`
- `docs/publishing-storage-comparison.md`
- `docs/http-402-integrations.md`
- `docs/archive/chaos-engineering-report-2026-04-06.md`

Removed redundant skills:

- `skills/resolve-issue-queue/SKILL.md`
- `skills/test-regtest/SKILL.md`
- `skills/test-tlsn/SKILL.md`
- `skills/unix-software-design/SKILL.md`
- `skills/unix-software-design/agents/openai.yaml`

Verified with:

- `test -L .claude/skills && test -L .codex/skills`
- `rg -n "docs/issues|skills/" README.md packages/*/README.md docs/architecture.md docs/README.md`
- `rg -n "development-publishing-strategy|blossom-nip23|publishing-storage-comparison|http-402-integrations|resolve-issue-queue|test-regtest|test-tlsn|unix-software-design|chaos-engineering-report" README.md CONTRIBUTING.md CLAUDE.md AGENTS.md docs/README.md docs/review-harness.md docs/resilience-checklist.md skills specs packages examples scripts`
- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- `docs/README.md` now keeps only public product docs and immediately useful
  maintainer workflow docs in the docs index.
- `skills/README.md` now limits repository-local skills to issue bookkeeping
  and semantic checks that are not already captured by Deno tasks, scripts,
  specs, or docs.

Review residuals:

- None.

Follow-up:

- #0085 owns the final public repository layout pass after remaining cleanup
  dependencies close.
