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
