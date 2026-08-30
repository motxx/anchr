# Complete Provider preflight and redeem recovery

Created: 2026-08-29
Model: GPT-5

## Priority

bug

## Dependencies

Depends on:
- 0186
- 0196
- 0248
- 0250

Blocks:
- None

## Summary

The Provider currently verifies an HTLC before work and attempts redemption
after receiving a preimage, but failures are caught and silently end the job.
The Provider cannot report whether redemption is safe to retry, uncertain,
already completed, or recovered after an interrupted mint swap, and its saved
state cannot resume an unredeemed result after restart. Complete the
Provider-owned preflight and redemption capability without turning audit
metadata into a condition that strands a spendable Provider-bound token.

## Rationale

- `packages/sdk/src/provider.ts` correctly places
  `verifyProviderPaymentLock` before `offer.produce`, but a verification error
  only returns from the event handler and is not represented as a durable
  outcome.
- The same flow catches every `redeemHtlc` failure and returns, discarding the
  distinctions already available from the Cashu redeem implementation.
- `packages/sdk/src/payments/cashu/redeem-swap.ts` distinguishes retry-safe,
  uncertain, and restored outcomes, but the Provider role does not preserve or
  expose them.
- Provider state has `offer_published`, `result_published`, and `redeemed`, but
  no state for waiting on Release Material, retrying redemption, or an unknown
  mint result.
- 0186 owns the rule separating spendability from clean settlement and audit
  findings; 0196 leaves one Cashu implementation; 0248 defines Release Material
  branches; 0250 grants the Provider only verify/redeem authority.

## Acceptance

- Before invoking work, the Provider verifies through its Payment Lock
  capability that the token is unspent, has the selected net amount after
  fees, is bound to the selected Provider, uses the expected Oracle condition,
  has the expected locktime and Customer refund key, requires the intended
  signatures, and leaves enough time to finish and redeem.
- Failure of any required preflight check prevents the work callback and
  records a typed reason suitable for retry or terminal handling without
  exposing secret payment material.
- After valid Release Material arrives, the Provider attempts redemption and
  preserves whether it succeeded normally, recovered registered outputs,
  remains safe to retry, or has an unknown outcome.
- A retry-safe or unknown result is not recorded as redeemed and does not
  discard the Provider Redemption Token or Release Material.
- With a configured state store, restart from a submitted result resumes
  waiting or redemption and reaches `redeemed` without rerunning the work.
- Query or request correlation mismatches remain audit findings. In accordance
  with 0186, they do not suppress an economic redeem attempt when the held
  token and Release Material satisfy the Payment Lock capability.
- The Provider dispatches the `payment_lock_type` from 0248 to its matching
  verify/redeem capability and has no Customer refund or Oracle release
  authority.

## Verification

- A table-driven preflight test mutates each required binding independently
  and proves the work callback is never called for the invalid case.
- Unit tests cover normal success, restored outputs, safe retry, unknown mint
  state, repeated delivery, and restart after result publication.
- A settlement-rule test introduces correlation anomalies while leaving the
  token economically spendable and proves redemption is attempted while the
  anomaly remains in audit output.
- `deno task test:unit`, `deno task test:e2e:regtest`, and
  `deno task lint:strict` pass.

## Plan

- Define typed preflight and redemption outcomes on the Provider capability,
  then make the Provider state transitions preserve every nonterminal outcome.
- Resume release waiting or redemption from stored state without rerunning
  completed work.
