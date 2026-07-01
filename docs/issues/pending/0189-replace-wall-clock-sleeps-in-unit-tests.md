# Replace wall-clock sleeps in unit-tier tests with deterministic signals

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

Unit-tier tests use `await new Promise(r => setTimeout(r, N))` to wait for async
offer windows and in-memory relay propagation. Hardcoded millisecond waits are
a classic flakiness source under CI load, and the unit tier is supposed to be
I/O-free and deterministic.

## Rationale

- `packages/sdk/src/provider.test.ts` (~20 sleeps at 5/10/30/60/70/80 ms),
  `integration.test.ts` (~lines 177, 206, 243),
  `requests/application/query-service-lifecycle.test.ts`.

## Acceptance

- These tests await a deterministic signal (a promise/event from the relay
  stub) or an injected controllable clock instead of sleeping.

## Verification

- `rg "setTimeout" packages/sdk/src --glob '**/*.test.ts'` shows no
  synchronization sleeps in the unit tier (timeouts asserting real timeout
  behavior may remain, called out explicitly).

## Plan

- Expose a completion signal from the in-memory relay/offer stubs.
- Inject a controllable clock where windowing time is asserted.
