# Move residual helpers to SDK

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

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

## Resolution

Implemented by updating:

- `packages/sdk/src/attachments/`
- `packages/sdk/src/payments/`
- `packages/sdk/src/internal/runtime/`
- `e2e/regtest/regtest-cashu.test.ts`
- `deno.json`

Deleted:

- `packages/bounty/src/`

Verified with:

- `rg -n "packages/bounty/src/(infrastructure/(attachment|blossom|cashu|claim-gate|escrow|frost|verification)|runtime|attachments|claim-gate|escrow|verification)" packages e2e deno.json`
- `rg -n "@anchr/bounty/(attachments|claim-gate|escrow|verification)|@anchr/sdk/bounty" packages e2e deno.json`
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/sdk/src/attachments/access.test.ts packages/sdk/src/attachments/upload.test.ts packages/sdk/src/internal/runtime/config.test.ts packages/sdk/src/payments/wallet-store.test.ts packages/sdk/src/payments/htlc-escrow.test.ts packages/sdk/src/payments/preimage-store.test.ts packages/sdk/src/payments/redeem-htlc.test.ts packages/sdk/src/payments/cashu-escrow-provider.test.ts packages/sdk/src/payments/frost-escrow-provider.test.ts packages/sdk/src/payments/frost-signer.test.ts`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`

Harness update:

- SDK unit tests moved with the retained helpers, and e2e/regtest now imports
  attachment normalization from `@anchr/sdk/attachments`.

Review residuals:

- None.

Follow-up:

- #0060 deletes the remaining `packages/bounty/` package shell and workspace
  manifest references.
