# Complete Customer timeout refund and recovery

Created: 2026-08-29
Model: GPT-5

## Priority

bug

## Dependencies

Depends on:
- 0196
- 0248
- 0250

Blocks:
- None

## Summary

The paid-request contract gives the Customer a timeout refund when the Payment
Lock expires without a completed Provider redemption, but the Customer flow
does not perform that refund. After creating the lock it only attaches the
token, proofs, and refund key to a thrown error. Callers must interpret an
error as a fund-recovery interface, keep secret material themselves, and
implement the actual Cashu refund. Complete the Customer-owned refund
capability and make its outcome recoverable across interruption.

## Rationale

- `packages/sdk/src/customer.ts` records request progress but has no refunded,
  refund-pending, or uncertain payment state.
- `PaymentRecoveryError` exposes payment material on ordinary errors instead
  of providing an explicit Customer refund operation.
- A result timeout, invalid result, relay failure, or process restart after
  Provider Selection can leave the Customer holding a refundable Payment Lock.
- Refund eligibility is economic: the locktime has passed and the held proofs
  have not already been spent. Application request status alone cannot prove
  either condition.
- 0196 must leave one owner for Cashu locktime/refund behavior; 0248 identifies
  the Payment Lock type; 0250 gives the Customer only prepare/refund authority.

## Acceptance

- The Customer has an explicit operation that attempts refund for a selected
  Payment Lock and returns a typed outcome rather than requiring callers to
  recover funds from an exception.
- Before lock expiry, the operation performs no refund spend and reports that
  the lock is not yet refundable.
- After expiry, an unspent Customer-bound lock is exchanged for Customer-owned
  proofs and recorded as refunded.
- A lock already redeemed by the Provider is not reported as refunded.
- Mint failure distinguishes a safe retry from an unknown or already-spent
  state. An unknown outcome is never recorded as refunded or discarded.
- With a configured state store, restart after Provider Selection preserves
  enough protected state to resume refund without publishing, logging, or
  attaching refund secrets to an ordinary error.
- Repeating refund after success is idempotent from the Customer API: it does
  not attempt to spend the original proofs again and returns the recorded
  result.
- The implementation uses only the Customer prepare/refund capability defined
  by 0250 and dispatches by the `PaymentLockType` defined by 0248.

## Verification

- Clock-controlled unit tests prove no spend before expiry and a successful
  refund after expiry.
- Unit tests cover unspent/retry-safe, spent, unknown, interrupted-and-restored,
  and repeated-after-success outcomes without logging or returning refund
  secrets in an error.
- A restart test creates a lock, reconstructs the Customer with the same state
  store, advances past expiry, and refunds it exactly once.
- A publication test inspects event content and tags and decrypts every
  recipient payload, proving that the Customer refund secret key is never
  published. The Payment Lock may expose only its refund public key; Provider
  Redemption Tokens and proofs required by the selected Provider remain
  allowed in that Provider's encrypted payload.
- `deno task test:unit`, `deno task test:e2e:regtest`, and
  `deno task lint:strict` pass.

## Plan

- Define the Customer refund operation and its persisted outcome from the
  Customer capability, then route the Cashu implementation through the single
  Payment Lock owner established by 0196.
- Replace exception-attached recovery material with the explicit refund and
  recovery path.
