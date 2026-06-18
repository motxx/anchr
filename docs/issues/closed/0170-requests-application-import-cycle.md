# Break requests/application import cycle

Created: 2026-06-19
Completed: 2026-06-19
Model: GPT-5.5 (codex:rescue)

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`sprawlens analyze .` reports the last of the three legacy import cycles in
`packages/sdk/src` — a 5-file strongly-connected component centred on
`query-service.ts` and its extracted helper modules:

- `requests/application/query-service.ts`
- `requests/application/query-service-deps.ts`
- `requests/application/query-lifecycle-methods.ts`
- `requests/application/escrow-flow-methods.ts`
- `requests/application/verification-orchestration.ts`

## Rationale

The SCC follows the same shape the two prior fixes (issues 0168, 0169)
addressed: the parent service module defines public types
(`CreateQueryOptions`, `SubmitQueryOutcome`, `CancelQueryOutcome`,
`QueryHooks`, `HtlcOutcome`) that each helper module imports back, closing
the cycle. The helper modules only need the types — they never need the
runtime value `createQueryService` — so the parent's value module and its
type module can be split without touching any function body.

The uniform fix is the same as the prior PRs: hoist the cycle-participating
types into a leaf file (`query-service-types.ts`) that has no application
imports of its own, re-export them from `query-service.ts` to preserve the
public surface, and switch each helper's import to the leaf.

## Acceptance

- No helper module in this SCC (`query-service-deps.ts`,
  `query-lifecycle-methods.ts`, `escrow-flow-methods.ts`,
  `verification-orchestration.ts`) imports a type from
  `./query-service.ts`.
- External consumers of `CreateQueryOptions`, `SubmitQueryOutcome`,
  `CancelQueryOutcome`, `QueryHooks`, `HtlcOutcome` still import them from
  `./query-service.ts` via re-export.
- `sprawlens analyze .` cycle count drops from one to zero.

## Verification

- `deno task lint:strict`
- `deno task test:unit -- requests`
- `deno task test:unit -- query`

## Plan

- Add `packages/sdk/src/requests/application/query-service-types.ts`
  containing the five cycle-participating types.
- Replace the inline declarations in `query-service.ts` with re-exports
  from the new leaf.
- Switch the type imports in each helper module from `./query-service.ts`
  to `./query-service-types.ts`.

## Resolution

Implemented by updating:

- `packages/sdk/src/requests/application/query-service-types.ts` (new)
- `packages/sdk/src/requests/application/query-service.ts`
- `packages/sdk/src/requests/application/query-service-deps.ts`
- `packages/sdk/src/requests/application/query-lifecycle-methods.ts`
- `packages/sdk/src/requests/application/escrow-flow-methods.ts`

Verified with:

- `deno task lint:strict` — pass
- `deno task test:unit -- requests` — 310 passed | 0 failed
- `deno task test:unit -- query` — 310 passed | 0 failed
- grep confirms no helper module in the SCC still imports from
  `./query-service.ts`.

Harness update:

- None — `lint:arch` already forbids new import cycles in `packages/`; this
  closes the last legacy SCC and the three cycles known to `sprawlens` are
  fully gone.

Review residuals:

- None.

Follow-up:

- None — the cycle backlog is empty.
