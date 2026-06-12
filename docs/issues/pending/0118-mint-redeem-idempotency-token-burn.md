# Make mint redeem idempotent to prevent token burn

Created: 2026-06-11
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The Cashu redeem swap has no idempotency guard. If the mint commits the swap but
the HTTP response is lost (timeout/reset), the input HTLC proofs are spent at the
mint while the SDK reports failure, and the redeemed value is unrecoverable. A
network error must never burn a token.

## Rationale

From the 2026-06-11 production-readiness audit §2.5 (PROT-07, folds OPS-03):

- `packages/sdk/src/payments/cashu/cashu-escrow-helpers.ts:34-73` `loadAndSend`
  uses a 30s `Promise.race` timeout that rejects without aborting the in-flight
  HTTP request.
- `packages/sdk/src/payments/cashu/cashu-escrow.ts:299-341` `redeemHtlcToken`
  returns `null` on any throw; `packages/sdk/src/adapters/cashu.ts:406-419`
  `redeemHtlc` wraps the swap and throws `CashuMintError`.
- No `checkProofsStates`/restore/retry exists on the redeem path; cashu-ts mints
  fresh random blinding per call, so a naive retry produces different outputs.

## Acceptance

- After a failed redeem swap, the SDK checks proof state; if the inputs are
  already `SPENT` it recovers the outputs (persisted or deterministically
  re-derivable) rather than reporting total loss, and surfaces a distinct
  "uncertain — check mint" error rather than a flat `null`/generic throw.
- A retry after a committed-but-timed-out swap does not double-spend or burn.

## Verification

- `deno task test:e2e:regtest` with a new interrupted-swap case: a wallet whose
  swap resolves the mint-side state change but rejects the returned promise; the
  redeem path recovers the outputs or reports an uncertain state — never silent
  loss.
- `deno task lint:strict`

## Plan

- Re-read the redeem path in `cashu-escrow.ts` / `adapters/cashu.ts` and the
  cashu-ts send/`checkProofsStates` API.
- Persist intended outputs before the swap or query proof state on failure;
  branch on `SPENT` to recover, on `UNSPENT` to safely retry.
- Lock with the regtest interrupted-swap test.
