# Bound unbounded long-running Oracle state and wire the query sweep

Created: 2026-06-11
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

A long-running Oracle accumulates unbounded process-global state — a TLSN
replay-hash set, FROST sessions, and per-query relay subscriptions — and never
expires queries despite a config knob implying it does. This is a memory/FD leak
and slow-DoS in the always-on Oracle the design targets.

## Rationale

From `docs/production-readiness-audit.md` §2.7 (OPS-05):

- `packages/sdk/src/proofs/tlsn-validation.ts:30,337` — `seenPresentations` is
  module-global with only a test-only clear (no TTL/eviction).
- `packages/sdk/src/payments/frost/frost-coordinator.ts:70-72,88,176-177` —
  `dkgSessions`/`signingSessions`/`querySessionMap` are only `.set()` (no
  `delete`/`clear`).
- `oracle-service.ts` `watched` entries (2 relay subscriptions each) are added
  but never removed per-query at terminal state.
- `packages/sdk/src/internal/runtime/config.ts:52` reads `querySweepIntervalMs`
  but it has no consumer, and `packages/sdk/src/requests/application/query-service.ts:197-198`
  `expireQueries`/`purgeExpiredFromStore` have no caller — no `setInterval`
  sweep exists.

## Acceptance

- `seenPresentations` is bounded (TTL/LRU or persistent store with eviction).
- FROST sessions are removed after aggregation/abort.
- `watched` entries are removed and their subscriptions closed when a request
  reaches a terminal state.
- A query sweep runs on `querySweepIntervalMs` (cleaned up on Oracle `stop()`),
  or the dead `querySweepIntervalMs`/`purgeExpiredFromStore` surface is removed
  and host responsibility is documented.

## Verification

- New unit tests assert eviction/removal for each store under load.
- Expected:
  `rg -n "delete|clear" packages/sdk/src/payments/frost/frost-coordinator.ts`
  shows cleanup; `rg -n querySweepIntervalMs packages/sdk/src` shows a consumer
  (or the knob is removed and no match is expected).
- `deno task lint:strict`

## Plan

- Re-read each store's lifecycle and the Oracle `stop()` path.
- Add bounded eviction + terminal-state cleanup; wire the sweep timer with
  teardown, or delete the dead sweep surface.
- May be split with `make-sub-issues` per store if one change is too broad.
