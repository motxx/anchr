# Prune docs skills for public release

Created: 2026-05-27
Model: GPT-5 Codex

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
protocol. The cleanup should distinguish public docs from maintainer workflow
instead of deleting useful operational context blindly.

For human-in-the-loop planning, product review, engineering review, design
review, and office-hours style reconsideration, prefer the maintained gstack
skills instead of growing Anchr-specific duplicates. Repository-local skills
should stay narrow: file-based issue bookkeeping, Anchr-specific verification,
and project-specific semantic checks that gstack does not own.

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
