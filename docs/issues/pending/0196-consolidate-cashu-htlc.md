# Consolidate the two Cashu HTLC implementations into one owner

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0254
- 0255

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
- Additional evidence (2026-07-02 architecture review): the duplicated
  security ruleset in `verifyProviderPaymentLock` (`adapters/cashu.ts`) —
  locktime remaining ~:279, duplicate proofs ~:289, HTLC hash mismatch ~:335,
  refund-key match ~:349, locktime match ~:355, SIG_ALL required ~:361 —
  each must be kept in sync with `cashu-escrow.ts` by hand today.
- Placement note for the resolver: `frost-escrow-provider.ts` lives under
  `payments/cashu/` while the FROST math lives in `payments/frost/`; place it
  deliberately during consolidation.

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
