# Payment-path robustness and info-leak hardening (low severity)

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Three low-severity hardening items on the payment/redemption path: an exported
preimage-hash helper throws on malformed input, FROST share submissions are not
authenticated to the signer slot, and rejection DMs echo detailed hashlock/
amount values. None is a forgery on its own (FROST aggregation still rejects
bad shares), but each is a robustness or information-exposure smell worth
closing together.

## Rationale

- `packages/sdk/src/payments/cashu/preimage-store.ts` (~lines 32-38):
  `preimage.match(/.{2}/g)!` throws a `TypeError` on empty/odd-length hex
  instead of returning `false`.
- `packages/sdk/src/payments/frost/frost-coordinator.ts` (~lines 221-231):
  `submitNonceCommitment` / `submitSignatureShare` key on caller-supplied
  `signerPubkey` with no auth that the submitter owns the slot (griefing/DoS).
- `packages/sdk/src/payments/cashu/cashu-escrow.ts` (~lines 392, 409-427) and
  `adapters/cashu.ts` embed expected/received hashes into rejection strings
  that propagate into Provider-facing DMs (`oracle-service.ts` ~lines 274, 296).

## Acceptance

- `verifyPreimageHash` validates `/^([0-9a-f]{2})+$/i` and returns `false` on
  malformed input.
- Share submissions are authenticated to the signer identity.
- Rejection messages sent to the Provider are generic (details stay in local
  logs).

## Verification

- Unit test: malformed preimage returns `false`, not a throw.
- Unit test: a share submitted under a slot the caller does not own is
  rejected.
- Unit tests assert that each Provider-facing rejection uses its fixed public
  reason and contains no expected or received hash, Release Material, proof,
  mint response, internal exception text, or dynamically derived payment
  detail. Diagnostic values remain only in local logs.

## Plan

- Add preimage validation; authenticate share submissions; genericise wire
  rejection messages.
