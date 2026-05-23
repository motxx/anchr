# Align proof runtime layout

Created: 2026-05-21
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0043

## Summary

Align proof-engine and runtime-helper package names and ownership with the
capabilities they expose.

## Rationale

Parent issue: #0043.

The target taxonomy describes `packages/proofs/{tlsn,photo}` and
`packages/runtime`, but the current tree keeps `packages/tlsn-toolkit`,
`packages/photo-verification`, and `packages/core-runtime` at the package root.
That mismatch makes the target directory map misleading.

The naming problem is especially visible for `core-runtime`: the package is a
runtime compatibility helper, not a more important part of Anchr than the actor
SDKs or proof engines. If it keeps `core-*`, the docs need to explain that
"core" means dependency-root utility, not product importance.

Relevant files:

- `docs/architecture.md`
- `packages/tlsn-toolkit/`
- `packages/photo-verification/`
- `packages/core-runtime/`
- `packages/bounty/src/infrastructure/verification/`
- `examples/`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`

## Plan

- Decide whether proof and runtime packages keep flat package directories or are
  renamed to capability-revealing flat package names.
- Remove or justify `core-runtime` naming. If it remains, document exactly what
  makes it foundational and which packages use it.
- Update the package map so `tlsn-toolkit` and `photo-verification` clearly say
  which proof checks they perform independently.
- If renaming or moving, update import maps, workspace entries, package
  manifests, README and SPEC references, lint allow-lists, and examples in the
  same change.
- Keep proof engines reusable and keep runtime helpers as the dependency root.
- Verify with proof/runtime package tests, affected examples, and
  `deno task lint:strict`.
