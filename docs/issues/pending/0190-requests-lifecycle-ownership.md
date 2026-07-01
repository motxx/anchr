# Decide the owner of the paid-request lifecycle (requests/ vs role clients)

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

The documented paid-request lifecycle core in `requests/` (the
create → offer → select → submit → verify → release → expire state machine) is
imported only by test helpers, while production `customer.ts` and `provider.ts`
each maintain their own divergent status models. There are effectively two
lifecycle implementations that can drift apart, and `docs/architecture.md`
names `requests/` the single owner. This is a tracking/decision issue: pick one
owner before restructuring.

## Rationale

- `requests/domain/query-aggregate.ts`, `query-transitions.ts`,
  `requests/application/query-service.ts` are imported only by
  `testing/protocol-helpers.ts` / `testing/mod.ts`; arch-lint E026 hard-codes
  `query-service.ts` as importable only by `testing/`.
- `customer.ts` (~lines 601-604) and `provider.ts` (~lines 480-501) hold
  independent status models.
- `docs/architecture.md` ("SDK Request Internals") claims `requests/` owns the
  lifecycle.
- Additional evidence (2026-07-02 architecture review):
  - Verified by grep: outside `requests/`, `query-service.ts` /
    `createQueryService` are imported only by `testing/mod.ts` and
    `testing/protocol-helpers.ts`; `query-aggregate.ts` has zero non-test
    importers. The canonical state machine has no production consumer.
  - The threat-model/attack e2e suites (`e2e/protocol/paid-request-attacks`,
    `paid-request-vulns`, `paid-request-trustless`, `e2e/regtest/core-flow`,
    `regtest-cashu`, `e2e/tlsn/tlsn`) drive `QueryService` via
    `@anchr/sdk/testing` — they verify a lifecycle implementation that
    production does not run.
  - A third production state model exists beside the two facade models:
    `adapters/nostr/oracle-handlers.ts:16-24` `WatchedQuery`
    (selected/offered providers + release gating) — see 0200.
  - `"provider_selected"` appears as an unrelated literal in both enums
    (`customer.ts:482`, `query-aggregate.ts:239`) — collision, not a shared
    type.
  - `customer.ts` and `provider.ts` co-changed in 11 of the 12 commits (last
    300) touching either — today they behave as one module.
  - The arch-lint E026 whitelist (11 importer entries in
    `scripts/arch-lint.ts`) holds this boundary by per-file exception; expect
    it to shrink to principles once ownership is decided.
  - Review recommendation: demoting the aggregate to `testing/` would leave
    the attack-test assets verifying throwaway code; driving the facades
    through the aggregate is the option consistent with the threat-model
    harness.

## Acceptance

- A recorded decision: either `customer.ts`/`provider.ts` are driven through
  the `requests/` aggregate (making it the real owner), or `requests/domain` +
  `query-service` are demoted to `testing/` and the architecture-doc ownership
  claim is removed. The decision lists the concrete follow-up change issues.

## Verification

- Decision captured in `docs/architecture.md` (or an ADR); follow-up issues
  created for the chosen migration.

## Plan

- Compare the two lifecycles; choose one owner.
- Split the resulting migration/cleanup into child issues (0191 executes the
  role-client refactor).
