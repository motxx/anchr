# Single owner for the HTLC redeem swap

Created: 2026-06-13
Model: Claude Fable 5 (claude-fable-5)

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Two parallel HTLC redeem implementations exist: the public client port
(`packages/sdk/src/adapters/cashu.ts` `redeemHtlc`) and the direct payments
helper (`packages/sdk/src/payments/cashu/cashu-escrow.ts`
`redeemHtlcToken`). Both prepare the preimage witness, sign with the
Provider key, and swap at the mint, but their failure handling has
diverged: the adapter pre-registers outputs and recovers a committed swap
via NUT-09 restore (issue 0118), while the payments path only classifies
spent-ness and throws. One owner should hold the witness-prep + swap +
recovery core, with the other surface delegating.

## Rationale

- Found by the `arch-lint-llm` review (L003) on 2026-06-13 while closing
  issue 0118. Pre-existing structure; the recovery work widened the drift.
- `redeemHtlcToken` additionally performs server-side P2PK spend
  verification (`verifyHtlcSpendAuth`) used by the regtest trustless suite;
  that check must survive consolidation.

## Acceptance

- One module owns witness preparation, the redeem swap, and
  interrupted-swap recovery; the other surface delegates to it.
- The NUT-09 recovery path covers both entry points.

## Verification

- `deno task test:unit`
- `deno task test:e2e:regtest`

## Plan

- Extract the shared redeem core into `payments/cashu` (the adapters layer
  may depend on payments, not the reverse) and have `redeemHtlc` delegate.
