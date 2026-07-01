# Make Cashu verifyToken fail closed when the mint is unavailable

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`verifyToken` skips the unspent/double-spend mint check when no wallet/mint is
configured and returns `{ valid: true }` for any structurally-decodable token
whose face amount meets the minimum. This is the amount check used at
provider-selection time, so in any deployment without a live mint URL a
Provider can be selected against already-spent or fabricated proofs. The
customer-side `requireProofsUnspent` already fails closed, so the codebase is
inconsistent.

## Rationale

- `packages/sdk/src/payments/cashu/cashu-wallet.ts` (~lines 196-223): the
  `checkProofsStates` call is gated on `if (wallet) { … }`; the else path
  returns valid without a double-spend check.
- Reached via `cashu-escrow-provider.ts` (~lines 92-102) →
  `verifyEscrowAmount` → `verifyToken`.
- Contrast `adapters/cashu.ts` `requireProofsUnspent` (~lines 369-403) which
  throws when the state check is unavailable.

## Acceptance

- `verifyToken` returns `valid:false` (or throws consistently with the
  customer path) when the mint cannot be reached to confirm `UNSPENT`.

## Verification

- Unit test: with no mint configured, `verifyToken` does not return
  `valid:true` for a token it cannot check.

## Plan

- Remove the fail-open branch; require a reachable mint for the unspent check
  or fail closed with a clear error.
