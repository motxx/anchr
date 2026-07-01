# Consolidate the two Cashu HTLC implementations into one owner

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Two modules independently own overlapping Cashu HTLC lock/verify/redeem
behavior: the `CashuClient` adapter and the escrow module both decode tokens,
verify HTLC hashlocks, and drive the two-phase hashlock + P2PK + locktime +
refund lock. Duplicated ownership of the settlement-lock primitive means the
security rules (locktime, refund key, SIG_ALL) must be kept in sync in two
places.

## Rationale

- `packages/sdk/src/adapters/cashu.ts` (758 lines:
  `bindProvider`/`verifyProviderPaymentLock`/`redeemHtlc`).
- `packages/sdk/src/payments/cashu/cashu-escrow.ts` (455 lines: two-phase HTLC
  + 2-of-2 P2PK lock).
- They share only `buildHtlcFinalOptions` and `redeemSignedProofs`.

## Acceptance

- HTLC construction/validation lives in one payments module that both the
  `CashuClient` adapter and the `EscrowProvider` consume; the security rules
  exist in exactly one place.

## Verification

- `deno task test:unit` + `deno task test:e2e:regtest` pass against the
  consolidated module.
- The HTLC hashlock/locktime/refund logic is defined once (grep confirms no
  second copy).

## Plan

- Extract a single HTLC primitive module; route both consumers through it.
