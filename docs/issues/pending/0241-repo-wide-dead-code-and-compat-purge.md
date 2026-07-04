# Purge dead code and backward-compat remnants repo-wide

Created: 2026-07-04
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Sweep the entire repository for dead code and backward-compatibility
remnants and delete them outright, per the pre-1.0 versioning policy
(no deprecation shims, no legacy aliases, no compat re-exports). This is
a tracking issue: the resolver re-reads the current tree, builds the
concrete deletion list, and either resolves directly or splits it with
`make-issues` first if one coherent verified change would be too large.

In scope:

- Unreferenced exports, functions, types, and modules under
  `packages/protocol/src/`, `packages/sdk/src/`, `scripts/`, `e2e/`,
  and `examples/`.
- Re-exports, aliases, or wrapper functions whose only purpose is to
  keep old call sites working after a rename or move.
- Stale feature flags or env switches where only one branch is ever
  taken, and other unreachable branches.
- Orphaned test helpers and fixtures referenced by no test.
- Unused dependencies: `deno.json` import-map entries and
  `crates/*/Cargo.toml` dependencies with no remaining consumer.
- Docs and spec prose describing surfaces that no longer exist in the
  tree (per the documentation-prose policy in `CLAUDE.md`).

Out of scope (owned elsewhere — do not double-delete):

- Dead abstractions inside `requests/` (`QueryRepository`,
  `queryTemplates`, `"submitted"` status, `ProofDelivery`, duplicate
  open-status predicates) — owned by 0228.
- The production-deadness of the `requests/` Query aggregate and
  `query-service` — gated on the 0190 ownership decision; a 0190
  migration may deliberately revive them, so leave them in place.

## Rationale

- `CLAUDE.md` Versioning (pre-1.0): "Delete replaced paths outright. No
  `@deprecated`, 'legacy', or 'backward compat' shims."
- `lint:deprecation` catches explicit markers, but semantically dead
  code (exports with no importer, single-branch flags, orphaned
  fixtures, unused deps) has no automated gate today.
- The pattern recurs: 0210 (orphaned empty dirs) and 0220 (tlsn-server
  unused dependencies) each closed one instance; 0190's evidence shows
  further production-dead surfaces exist. No repo-wide sweep has run.

## Acceptance

- Every dead or compat-only surface found by the sweep is deleted, or
  kept with the reason recorded in the resolution note; deadness is
  verified against the current tree at resolution time.
- No export in `packages/` exists solely as a compatibility alias for a
  renamed or moved path.
- No `deno.json` import-map entry or crate dependency remains without a
  consumer.
- The sweep method (how deadness was established per category) is
  recorded in the resolution note, so a future sweep is repeatable.

## Verification

- `deno task test:all` passes after the deletions.
- `rg -n "backward.?compat|@deprecated|\blegacy\b" packages/ crates/ scripts/ e2e/ examples/`
  returns no matches (expected; confirms `lint:deprecation` ground truth
  after the sweep).
- For each deleted export, `rg` for its identifier across the repo
  returns no matches outside `docs/issues/` (expected).

## Plan

- Enumerate exports per module in `packages/*/src` and find importers;
  flag zero-importer exports (excluding the 0190/0228-owned set).
- Audit `deno.json` import maps and `crates/*/Cargo.toml` for unused
  dependencies (`cargo udeps` or manual `rg` per crate).
- Audit `e2e/`, `scripts/`, `examples/` for orphaned helpers/fixtures
  and single-branch flags.
- Build the deletion list; split into child issues if the verified
  change is too large; otherwise delete and run the full gate.
