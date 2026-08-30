# Prune dead abstractions and duplicates in requests/

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

The `requests/` lifecycle core carries abstractions with no production
consumer, duplicate logic under two names, an unreachable status value, and a
presentation string inside the pure domain. Each item below is independently
deletable; together they obscure which parts of the lifecycle core are real.
Note: 0190 may change lifecycle ownership — re-verify each item's deadness
against the tree at resolution time before deleting (e.g. a 0190 migration
could deliberately revive `submitted`).

## Rationale

- `requests/application/query-repository.ts` (97 lines): `QueryRepository`,
  `createInMemoryQueryRepository`, and `toRepository` are referenced only by
  their own test — a fully parallel, unused persistence abstraction next to
  the live `QueryStore`, duplicating open-status logic.
- `requests/domain/query-templates.ts` (41 lines): `queryTemplates` is
  referenced only by its own test, and its doc comment claims
  `import { queryTemplates } from "anchr"` although `index.ts` does not export
  it.
- `requests/domain/types.ts:15`: `QueryStatus` includes `"submitted"`, but no
  transition table or aggregate function ever produces it.
- `requests/domain/query-transitions.ts:43-45,55-57`: `isOpenStatus` and
  `isCancellable` have identical bodies — two names, one behavior.
- The open-status list is hardcoded three times: `query-repository.ts:34-39`,
  `query-repository.ts:75-80`, and inline in
  `requests/application/query-service.ts:163-168`.
- `requests/domain/challenge.ts:28-30` embeds Japanese user-facing copy in the
  pure domain layer — a presentation concern below the seam.
- `requests/application/ports.ts:126` `ProofDelivery` (1 method) has no
  production adapter; only `proof-delivery.test.ts` implements it. A
  test-only hypothetical seam wired through `ServiceDeps` and
  `verification-orchestration.ts:21-41` — implement a production adapter or
  delete the port.

## Acceptance

- Each listed item is deleted, or kept with the reason recorded in the
  resolution note; deadness is re-verified against the current tree first.
- No parallel persistence abstraction remains beside `QueryStore`; the
  open-status predicate has one definition; domain code carries no user-facing
  copy; every remaining port has at least one production adapter or a recorded
  implementation plan.

## Verification

- `rg "QueryRepository|queryTemplates" packages/sdk/src --glob '!*.test.ts'`
  returns no matches (expected after deletion).
- `rg '"submitted"' packages/sdk/src/requests` returns no matches (expected),
  or the resolution note records why the status became reachable.
- `deno task test:unit` and `deno task lint:strict` pass.

## Plan

- Re-verify each item's consumers with `rg`; delete or consolidate.
- Decide implement-vs-delete for `ProofDelivery` (align with the 0190
  direction).

Completed: 2026-07-06

## Resolution

Deadness re-verified per item against the tree at resolution time (0190 was
decided the same day: ADR 0003, aggregate owns the lifecycle — the migration
executor 0191 can reintroduce any of these with a production consumer and a
test, per the pre-1.0 delete-outright policy).

Deleted:

- `requests/domain/query-repository.ts` + `query-repository.test.ts` —
  importers were the file itself and its test only; removing it also removed
  two of the three hardcoded open-status lists.
- `requests/domain/query-templates.ts` + `query-templates.test.ts` — own-test
  only, and its doc comment advertised an export `index.ts` never had.
- `"submitted"` from `QueryStatus` — no transition table or aggregate function
  produced it; repo-wide grep found no other `"submitted"` status literal.
- `isCancellable` — identical body to `isOpenStatus`; the cancel guards in
  `query-aggregate.ts` and `query-lifecycle-methods.ts` now use
  `isOpenStatus` (constant renamed `CANCELLABLE_STATUSES` → `OPEN_STATUSES`).
  The third hardcoded list flagged in the issue
  (`query-service.ts:163-168`) had already been consolidated onto
  `isOpenStatus` before this resolution; one definition remains.
- `buildChallengeRule` and the `Query.challenge_rule` field — the Japanese
  instruction copy was the field's only producer and nothing outside its own
  tests consumed it; the structured facts (`challenge_nonce`, `description`)
  stay on the query, and instruction rendering is presentation-owned above
  the SDK seam.
- `ProofDelivery` + `ProofPublishResult` ports, the `proofDelivery` wiring in
  `QueryServiceDeps` / `ServiceDeps`, the `publishAttestations` best-effort
  branch in `verification-orchestration.ts`, the `Query.published_proofs`
  field, and `proof-delivery.test.ts` — no production adapter existed; the
  verification outcome never depended on publishing. Delete-not-implement is
  the ADR 0003-consistent call: attestation publishing is relay-adapter
  behavior, and 0191/0200 own giving it a production home if the migration
  needs one.

Implemented by updating:

- `packages/sdk/src/requests/domain/types.ts`
- `packages/sdk/src/requests/domain/query-transitions.ts`
- `packages/sdk/src/requests/domain/query-aggregate.ts` (+ test)
- `packages/sdk/src/requests/domain/challenge.ts` (+ test)
- `packages/sdk/src/requests/application/ports.ts`
- `packages/sdk/src/requests/application/query-service.ts`
- `packages/sdk/src/requests/application/query-service-deps.ts`
- `packages/sdk/src/requests/application/query-lifecycle-methods.ts`
- `packages/sdk/src/requests/application/verification-orchestration.ts`
- `packages/sdk/src/proofs/verification/verifier.test.ts` (fixture field)

Deleted files:

- `packages/sdk/src/requests/domain/query-repository.ts`,
  `query-repository.test.ts`, `query-templates.ts`, `query-templates.test.ts`
- `packages/sdk/src/requests/application/proof-delivery.test.ts`

Verified with:

- `grep -r "QueryRepository|queryTemplates|ProofDelivery|challenge_rule|
  published_proofs|isCancellable" packages/ e2e/ scripts/ examples/` — no
  matches outside `docs/issues/`.
- `grep -r '"submitted"' packages/` — no matches.
- `deno task check`, `deno task lint:strict`, `deno task test:unit`,
  `deno task test:integration`, `deno task test:all` — pass.
- `/check-silent-bypass` and `/arch-lint-llm` — no findings.

Harness update:

- None needed beyond existing guards — own-test-only deadness requires
  per-symbol public-API intent judgment (same rationale as 0241); the
  recurring residue classes are owned by pending issues 0191 (facade
  migration re-verifies what the lifecycle really needs) and 0242 (escrow
  factories).

Review residuals:

- If the 0191 migration needs attestation publishing or a `submitted` stage,
  it reintroduces them with a production adapter and a locking test — owned
  by 0191.

Follow-up:

- None (0191/0200/0242 pre-existing).
