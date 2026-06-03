# Reconcile live docs architecture drift

Created: 2026-05-30
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0082
- 0083
- 0101

Blocks:
- 0080
- 0085

## Summary

Reconcile live documentation that still points readers or agents at retired
package names and pre-collapse paths. The accurate map is the current
`docs/architecture.md` public contract: `@anchr/sdk` plus `@anchr/protocol`.

There are no external users to preserve compatibility for. Live docs should not
teach old package names, aliases, migration paths, or compatibility surfaces
unless they are explicitly historical.

## Rationale

The UNIX design review found that stale package-collapse references are not
limited to one `CLAUDE.md` section. Live operational docs still reference
deleted or moved owners, including:

- `CLAUDE.md` Runtime and Logging pointing at `@anchr/core-runtime`.
- `CLAUDE.md` Logging and Type bar pointing at `packages/bounty/src/...`.
- `CLAUDE.md` Layout listing the former multi-package map.
- `specs/README.md` pointing package homes at `packages/bounty/src/...`.
- `docs/review-harness.md` saying `lint:arch` owns layer direction inside
  `packages/bounty`.

Closed issues and archived historical docs may intentionally mention old
paths. The cleanup should target live guidance, not rewrite history.

For live guidance, prefer deletion or direct replacement over transitional
wording. The goal is a clean current map, not a migration guide from retired
surfaces.

## Acceptance

- Live operational docs no longer tell agents, contributors, or implementers to
  use deleted packages such as `@anchr/core-runtime` or `packages/bounty`.
- `CLAUDE.md`, `specs/README.md`, and `docs/review-harness.md` point to current
  SDK/protocol owners or explicitly say a reference is historical.
- Live docs do not preserve compatibility narratives, alias instructions, or
  migration paths for retired packages; they present the target SDK/protocol
  shape directly.
- Negative checks exclude historical issue archives and intentionally historical
  docs so the command cannot be satisfied by rewriting closed records.
- Any stale reference that belongs to public-release doc pruning is either
  fixed here or explicitly delegated to #0084 with a concrete note.

## Verification

- No live-doc matches are expected: `rg -n "@anchr/(core-runtime|core-cashu|customer-sdk|provider-sdk|oracle-sdk|bounty)|packages/(bounty|core-runtime)" CLAUDE.md AGENTS.md README.md specs docs/architecture.md docs/review-harness.md docs/universality-boundaries.md`
- `deno task lint:strict`
- Manual check: closed issues and archived historical docs were not rewritten
  solely to satisfy active documentation checks.

## Plan

- Inventory stale package-collapse pointers in live docs only.
- Update each live pointer to the current SDK/protocol owner or remove the
  obsolete instruction.
- Delete migration/compatibility wording from live guidance unless it is needed
  to protect protocol correctness, fund-flow safety, or documented spec
  semantics.
- Keep historical issue and archive text intact unless a live index presents it
  as current guidance.
