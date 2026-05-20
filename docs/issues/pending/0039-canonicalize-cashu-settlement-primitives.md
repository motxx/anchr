# Canonicalize Cashu settlement primitives

Created: 2026-05-20
Model: GPT-5

## Priority

design

## Dependencies

Depends on:
- 0037

Blocks:
- 0038
- 0041
- 0043

## Summary

Choose one canonical implementation for Cashu HTLC/P2PK settlement semantics
and make SDK/adapters delegate to it. The repository currently has overlapping
Cashu HTLC logic in `@anchr/core-cashu` and actor SDK Cashu adapter code.

## Rationale

Relevant references:

- `packages/core-cashu/src/escrow.ts`
- `packages/core-cashu/src/escrow-helpers.ts`
- `packages/customer-sdk/src/cashu.ts`
- `packages/provider-sdk/src/cashu.ts`
- `packages/cashu-conditional-swap/src/cross-htlc.ts`
- `packages/cashu-conditional-swap/src/frost-conditional-swap.ts`
- `e2e/regtest/`

One concrete boundary mismatch is the Phase 1 lock semantics:

- `core-cashu` describes Phase 1 as plain proofs held locally until Worker
  selection.
- The actor SDK Cashu adapter describes Phase 1 as P2PK-locked to the Customer
  before Provider selection.

This may be intentional, but it should not remain an implicit fork of the
settlement model. Settlement invariants are load-bearing and should have one
canonical package and one test suite that downstream adapters reuse.

## Plan

- Decide the canonical Phase 1/Phase 2 Cashu HTLC model and document why.
- Move or expose reusable functions from `core-cashu` so SDK Cashu adapters do
  not duplicate settlement construction.
- Align `cashu-conditional-swap` with the same lower-level primitives where
  practical.
- Update package READMEs and `SPEC.md` files to describe one settlement model.
- Verify with unit tests plus the relevant `e2e/protocol` and `e2e/regtest`
  coverage.
