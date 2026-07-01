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
