# Move residual helpers to SDK

Created: 2026-05-23
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0051
- 0052
- 0053
- 0057

Blocks:
- 0054

## Summary

Move remaining reusable attachment, Blossom, escrow, Cashu, FROST, proof,
configuration, logging, and runtime helpers out of `packages/bounty`, and
delete claim-gate-only surfaces that are not part of verifiable paid requests.

## Rationale

#0051, #0052, and #0053 absorbed the primary SDK owners for runtime,
attachment, payment, settlement, and proof helpers, but the bounty package still
contains residual implementations and tests. This child owns those leftovers
without also owning the lifecycle or Nostr/Oracle adapter moves.

Relevant current surfaces:

- `packages/bounty/src/infrastructure/attachment*.ts`
- `packages/bounty/src/infrastructure/blossom/`
- `packages/bounty/src/infrastructure/cashu/`
- `packages/bounty/src/infrastructure/escrow/`
- `packages/bounty/src/infrastructure/frost/`
- `packages/bounty/src/infrastructure/verification/`
- `packages/bounty/src/infrastructure/claim-gate/`
- `packages/bounty/src/runtime/`
- `packages/bounty/src/attachments.ts`
- `packages/bounty/src/claim-gate.ts`
- `packages/bounty/src/escrow.ts`
- `packages/bounty/src/verification.ts`
- `packages/sdk/src/attachments/`
- `packages/sdk/src/payments/`
- `packages/sdk/src/proofs/`
- `packages/sdk/src/internal/runtime/`

## Acceptance

- Retained attachment, Blossom, escrow, Cashu, FROST, proof, configuration,
  logging, and runtime helpers live under SDK modules with existing owner
  responsibilities.
- Claim-gate-only code is deleted unless a resolver records a concrete
  paid-request SDK owner and moves it there.
- SDK tests cover retained helper behavior after the move.
- No public `@anchr/bounty/attachments`, `@anchr/bounty/claim-gate`,
  `@anchr/bounty/escrow`, or `@anchr/bounty/verification` surface remains.

## Verification

- No matches are expected:
  `rg -n "packages/bounty/src/(infrastructure/(attachment|blossom|cashu|claim-gate|escrow|frost|verification)|runtime|attachments|claim-gate|escrow|verification)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Classify each residual helper by SDK attachment, payment, proof, adapter, or
  internal runtime ownership.
- Move retained helpers and tests to their SDK owners.
- Delete claim-gate-only code unless it has a narrow SDK paid-request owner.
- Rewrite imports and delete obsolete bounty helper barrels.
