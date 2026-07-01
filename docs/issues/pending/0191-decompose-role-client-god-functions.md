# Decompose the customer/provider inline lifecycle god-functions

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0190

Blocks:
- None

## Summary

`customer.ts` `request()` is a ~254-line function that inlines the entire
Customer lifecycle — validation, oracle selection, ephemeral identity, hash
bootstrap, publish, four state writes, offer windowing, offer selection,
payment-lock binding, result wait, decrypt/parse, schema verification, and
error decoration. `provider.ts` follows the same inline pattern. There is no
seam to unit-test any stage in isolation, so a change to offer selection risks
the payment path. The correct shape depends on the 0190 ownership decision.

## Rationale

- `packages/sdk/src/customer.ts` (~lines 304-558); `provider.ts` (~lines
  480-501 and the surrounding lifecycle).
- This inline code is the concrete duplicate of the `requests/` lifecycle
  flagged in 0190.
- Additional evidence (2026-07-02 architecture review): the twins duplicate
  scaffolding beyond the god-functions — per-role state blocks
  (`customer.ts:601-625` vs `provider.ts:475-504`: own status union, record
  interface, key fn, write fn), and `validateCustomerOptions` (~90 lines,
  `customer.ts:180-269`) vs `validateProviderOptions` (~107 lines,
  `provider.ts:83-189`) are near-identical unknown-narrowing including a
  byte-similar stateStore probe (`customer.ts:248-268` /
  `provider.ts:115-135`). Provider's god-pipeline is `handleJob`
  (~lines 298-464) with `waitForSelection`/`waitForPreimage` wrapping the
  shared `waitForFirstEvent`.

## Acceptance

- The lifecycle is expressed as discrete, independently testable steps
  (e.g. `collectOffers`, `bindPaymentLock`, `awaitAndVerifyResult`) — either by
  reusing the `requests/` stages or by extracting named functions, per 0190.

## Verification

- `deno task test:unit` covers the extracted steps directly.
- No single lifecycle function exceeds a reviewable size after the split.

## Plan

- Apply the 0190 decision.
- Extract the Customer steps first, then mirror for Provider.
