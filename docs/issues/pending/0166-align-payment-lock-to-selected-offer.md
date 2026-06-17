# Align Payment Lock to selected Provider Offer

Created: 2026-06-18
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
