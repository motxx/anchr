# Split the oracle-service adapter's four responsibilities

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

`adapters/nostr/oracle-service.ts` (502 lines) bundles subscription/watch
lifecycle, single-oracle verify-and-deliver (with an inline retry loop), FROST
threshold verify-and-deliver, quorum-vs-single dispatch policy, and a from-env
constructor. The most security-sensitive path (release authority) is hard to
isolate and test, and the "verify fails → build rejection DM → publish → log"
block is duplicated verbatim.

## Rationale

- `packages/sdk/src/adapters/nostr/oracle-service.ts`: single-oracle delivery
  (~246-262), FROST delivery (~287-364), dispatch policy (~366-391);
  the rejection block is copied at ~273-284 and ~295-306.

## Acceptance

- The rejection path is a single `deliverRejection()` helper; single-oracle and
  FROST delivery strategies live in separate modules behind the dispatcher; the
  factory owns only wiring.

## Verification

- `deno task test:unit` + `deno task test:integration` (oracle-service) pass;
  the rejection block exists once.

## Plan

- Extract `deliverRejection()`; split delivery strategies; keep the dispatcher
  thin.
