# Align Payment Lock to selected Provider Offer

Created: 2026-06-18
Completed: 2026-06-18
Model: GPT-5 Codex

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`Customer.request` should lock the selected Provider Offer's Requested Payment
Amount, not the Customer's Payment Budget. The domain glossary and exchange
spec now distinguish Payment Budget from Requested Payment Amount, and the
Payment Lock is part of the selected Provider's redeem path.

## Rationale

- `CONTEXT.md` defines Payment Budget as the Customer's public maximum and
  Requested Payment Amount as the Provider Offer amount.
- `specs/paid-request-exchange.md` states that the Payment Lock amount matches
  the selected Provider Offer's Requested Payment Amount.
- `packages/sdk/src/customer.ts` appears to build the initial Cashu lock from
  `req.payment.maxAmount`, while the selected offer's `amountSats` is used for
  selection but not as the lock amount.

## Acceptance

- A selected Provider Offer's Requested Payment Amount determines the
  redeemable Payment Lock amount.
- Offers above the Customer Payment Budget remain rejected.
- Customer-facing and Provider-facing payloads continue to expose the Payment
  Budget where the protocol requires it.
- Tests cover a selected offer amount lower than the Payment Budget and prove
  the Payment Lock uses the selected amount.

## Verification

- `deno test packages/sdk/src/customer.test.ts packages/sdk/src/provider.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task lint:strict`

## Plan

- Re-read the current Customer request flow, Cashu adapter API, and related
  tests before editing.
- Update the Payment Lock construction and binding path so the lock amount is
  selected-offer-owned while the Request Notice still carries the Payment
  Budget.
- While reading the payment port, re-evaluate whether `EscrowProvider`,
  `verify`, and `verifyLock` still describe their responsibilities after the
  selected-offer amount fix; create a follow-up issue only if the naming or port
  responsibility remains misleading.
- Add or update focused tests that fail under the current maxAmount-locking
  behavior.

## Resolution

Implemented by updating:

- `packages/sdk/src/customer.ts`
- `packages/sdk/src/customer-types.ts`
- `packages/sdk/src/customer.test.ts`
- `packages/sdk/src/integration.test.ts`
- `packages/sdk/src/provider.ts`
- `packages/sdk/src/provider-types.ts`
- `packages/sdk/src/provider.test.ts`
- `packages/sdk/src/adapters/types.ts`
- `packages/sdk/src/adapters/cashu.ts`
- `packages/sdk/src/adapters/cashu.test.ts`
- `packages/sdk/src/payments/cashu/redeem-swap.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/testing/cashu.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/events.test.ts`
- `examples/paid-request-simulation/mod.ts`
- `examples/paid-request-simulation/mod.test.ts`
- `examples/sdk-public-api-dogfood.test.ts`
- `e2e/protocol/anonymous-relay-flow.test.ts`
- `e2e/protocol/region-scoped-discovery.test.ts`
- `e2e/regtest/sdk-integration.test.ts`

The Customer flow now binds `fundingProofs` directly into a Provider-bound
Payment Lock after selecting the Provider. The removed preselection swap avoids
an extra mint round trip and lets the Cashu adapter create an exact Provider
net amount while returning Customer change proofs from the same mint operation.
Selection Feedback now carries the selected Provider Offer amount as
`execution.amount_sats`, and the Provider rejects a selection whose amount does
not match its own offer before producing work.

Verified with:

- `deno test packages/sdk/src/customer.test.ts packages/sdk/src/provider.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno test packages/sdk/src/adapters/cashu.test.ts packages/sdk/src/customer.test.ts packages/sdk/src/provider.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno test packages/sdk/src/adapters/cashu.test.ts packages/sdk/src/customer.test.ts packages/sdk/src/provider.test.ts packages/sdk/src/integration.test.ts examples/sdk-public-api-dogfood.test.ts examples/paid-request-simulation/mod.test.ts e2e/protocol/anonymous-relay-flow.test.ts e2e/protocol/region-scoped-discovery.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task check`
- `deno task lint:strict`
- `deno test --allow-all examples/sdk-public-api-dogfood.test.ts examples/paid-request-simulation/mod.test.ts`
- `deno task test:all`
- `check-silent-bypass` review of changed package payment files: no silent-bypass patterns detected
- `arch-lint-llm` review of changed package files: no semantic architecture violations detected

Harness update:

- `packages/sdk/src/customer.test.ts` now proves the Payment Lock uses the
  selected Provider Offer amount, not the Payment Budget, and rejects
  over-budget selector results before locking.
- `examples/sdk-public-api-dogfood.test.ts` now dogfoods the selected-offer
  lock amount in the public SDK simulation.

Review residuals:

- None

Follow-up:

- None
