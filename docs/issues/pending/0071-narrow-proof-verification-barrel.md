# Narrow proof verification barrel

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Fix the export direction inside `packages/sdk/src/proofs/` so the deeper
`proofs/verification/index.ts` barrel exports only verification-owned symbols.
The parent `proofs/mod.ts` should remain the public proof API barrel that
exports both individual proof primitives and the verification orchestrator.

Do not move directories or rename `verification/` in this issue. This is only
about removing parent-level primitive re-exports from the nested verification
barrel.

## Rationale

`packages/sdk/src/proofs/verification/index.ts` currently exports its local
verification functions from `./verifier.ts`, but it also re-exports parent
proof primitives from:

- `../ai-content-check.ts`
- `../exif-validation.ts`
- `../c2pa-validation.ts`
- `../tlsn-validation.ts`
- `../integrity-store.ts`

That makes a deeper directory act as a barrel for shallower sibling modules.
The natural direction is the reverse: `packages/sdk/src/proofs/mod.ts` is the
public proof barrel, and `proofs/verification/index.ts` owns only the
verification orchestrator surface.

## Acceptance

- `packages/sdk/src/proofs/verification/index.ts` exports only symbols owned by
  `packages/sdk/src/proofs/verification/`.
- Parent proof primitives remain exported from
  `packages/sdk/src/proofs/mod.ts`.
- Existing public imports from `@anchr/sdk/proofs` keep working.
- No directory move or `verification/` rename is introduced by this issue.

## Verification

- No matches are expected:
  `rg -n "from \"\\.\\./(ai-content-check|exif-validation|c2pa-validation|tlsn-validation|integrity-store)\\.ts\"" packages/sdk/src/proofs/verification/index.ts`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Remove parent proof primitive re-exports from
  `packages/sdk/src/proofs/verification/index.ts`.
- Keep `packages/sdk/src/proofs/mod.ts` as the single public barrel for proof
  primitives and verification functions.
- Run the focused re-export check, then unit tests and strict lint.
