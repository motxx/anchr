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

## Acceptance

- Public-facing docs are identified and reachable from the README or package
  READMEs.
- Maintainer-only docs and skills are either moved under an internal/maintainer
  location, clearly labeled as maintainer workflow, or left unlinked from the
  public docs index.
- Unused or obsolete skills identified by #0082 are deleted only when no
  current workflow references them.
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
- Prefer relabeling or internalizing useful workflow docs over deleting them.
- Delete only skills and docs that are obsolete, duplicated, or tied solely to
  removed repository surfaces.
