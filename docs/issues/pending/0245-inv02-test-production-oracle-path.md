# Make the INV-02 enforcement test drive the production Oracle path

Created: 2026-07-26
Model: Claude Opus 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- 0249

## Summary

`docs/threat-model.md` marks INV-02 ("the honest Oracle wrapper never returns
the Cashu HTLC preimage unless verification passes") as `enforced`, backed by
`e2e/protocol/paid-request-attacks.test.ts` — `preimage not leaked on rejected
verification`. That test drives `createQueryService` from `@anchr/sdk/testing`.
The `requests/application` service it exercises has zero production callers:
the production Oracle path is `packages/sdk/src/adapters/nostr/oracle-service.ts`
plus `oracle-handlers.ts`, which run verification through
`requests/application/query-verifier.ts` and deliver the preimage DM
themselves. INV-02 therefore proves nothing about the code that actually
guards preimage release in a deployed Oracle. Add a test that drives the
production path with failing proof material and asserts no preimage leaves.

## Rationale

- `grep -rln createQueryService` outside tests/`testing/` returns nothing in
  `packages/sdk/src` production modules; consumers are e2e tests via
  `@anchr/sdk/testing` only.
- The production rejection path lives in
  `packages/sdk/src/adapters/nostr/oracle-handlers.ts` (verification and
  rejection DM) and `oracle-service.ts` (preimage DM delivery,
  `payments/mod.ts` preimage store).
- INV-02 is the only invariant of INV-01..08 whose referenced test does not
  exercise production code (the others were checked on 2026-07-26).
- This lock must exist before the state-machine rewiring in 0249 so behavior
  is pinned during the migration.

## Acceptance

- A test drives the production Oracle event-handling path (not
  `createQueryService`) with adversarial submissions (malformed payload,
  invalid presentation, wrong Provider key) and asserts: no preimage DM is
  built or published, and the preimage store is not decremented.
- `docs/threat-model.md` INV-02 lists the new test; the INV-02 entry in
  `docs/threat-model.lock.json` is updated with a justification.

## Verification

- The new test fails if the production rejection path is made to leak the
  preimage (verified once by mutating the guard locally, then reverting).
- `deno task lint:invariants` passes.
- The e2e bucket containing the new test passes.

## Plan

- Locate the narrowest production entry that accepts a query result event and
  decides preimage delivery; drive it in-process with failing proofs.
- Update the threat-model Tests list and lock hash.
