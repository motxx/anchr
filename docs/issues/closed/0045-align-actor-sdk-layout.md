# Align actor SDK layout

Created: 2026-05-21
Model: GPT-5
Completed: 2026-05-21

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0043

## Summary

Make the actor SDK physical package layout match the accepted taxonomy, or
revise the taxonomy if the flat package names are intentionally kept.

## Rationale

Parent issue: #0043.

The target taxonomy in `docs/architecture.md` describes actor SDK ownership
under `packages/sdk/{customer,provider,oracle,anchr}`, but the current tree
keeps `packages/customer-sdk`, `packages/provider-sdk`, `packages/oracle-sdk`,
and `packages/sdk` as separate top-level packages. That makes the layout read
as both old and new at the same time.

Relevant files:

- `docs/architecture.md`
- `deno.json`
- `packages/customer-sdk/`
- `packages/provider-sdk/`
- `packages/oracle-sdk/`
- `packages/sdk/`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`

## Plan

- Decide from current package manifests and public imports whether actor SDKs
  should physically move under `packages/sdk/` or whether the documented target
  should bless the existing flat package names.
- If moving, rewrite imports, workspace entries, package manifests, build
  scripts, docs, and lint package detection in the same change.
- If keeping flat names, update `docs/architecture.md` and #0043 so the target
  tree no longer advertises a nested SDK layout.
- Verify with focused SDK checks, `deno task lint:strict`, and the relevant
  SDK/package tests.

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `docs/issues/pending/0043-update-boundary-lints-and-docs.md`

The actor SDK packages intentionally remain flat top-level packages for the
pre-1.0 tree: `customer-sdk`, `provider-sdk`, `oracle-sdk`, and aggregate
`sdk`. The target taxonomy no longer advertises a nested
`packages/sdk/{customer,provider,oracle,anchr}` layout.

Verified with:

- `deno task lint:fmt`
- `deno task lint:arch -- --errors-only`

Harness update:

- None — this is a package-layout decision locked in `docs/architecture.md`;
  #0043 remains pending for final lint/doc alignment after the remaining
  physical layout issues close.

Review residuals:

- None for actor SDK layout. Remaining non-actor package layout mismatches are
  tracked by #0046, #0047, and #0048.

Follow-up:

- #0043
