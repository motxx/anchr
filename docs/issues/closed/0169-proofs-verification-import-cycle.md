# Break proofs/verification import cycle

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

`sprawlens analyze .` reports a 3-file strongly-connected component spanning
`packages/sdk/src/schema.ts`,
`packages/sdk/src/proofs/verification/contract.ts`, and
`packages/sdk/src/proofs/verification/checks/types.ts`. The cycle is closed by
two type-edges that can be cut without changing any runtime surface.

## Rationale

Edges that close the cycle:

- `contract.ts` imports `SchemaUri` from `./schema.ts`, but `schema.ts` only
  re-exports `SchemaUri` from `@anchr/protocol/schema`. The indirection is
  decorative — taking `SchemaUri` straight from the protocol package removes
  one cycle edge with zero behavioural change.
- `checks/types.ts` imports `SchemaOptions` and `SchemaOptionsMap` from
  `schema.ts`, while `schema.ts` imports `FactorCheck` and `VerifyProofOptions`
  back from `checks/types.ts`. Hoisting the two tiny option aliases into a new
  leaf file (`packages/sdk/src/schema-options.ts`) cuts the second cycle edge
  while keeping `schema.ts` as the public surface via a `export type { ... }`
  re-export.

These two edits leave `checks/types.ts → contract.ts` and
`schema.ts → checks/types.ts` intact (those one-directional edges are
expected) and the SCC becomes acyclic.

## Acceptance

- `contract.ts` no longer imports from `./schema.ts`.
- `checks/types.ts` no longer imports from `../../../schema.ts`.
- Existing public consumers of `SchemaOptions` and `SchemaOptionsMap` still
  import them from `./schema.ts` (re-export keeps the path stable).
- `sprawlens analyze .` cycle count drops from two to one.

## Verification

- `deno task lint:strict`
- `deno task test:unit -- proofs`
- `deno task test:unit -- verification`

## Plan

- Add `packages/sdk/src/schema-options.ts` defining `SchemaOptions` and
  `SchemaOptionsMap`.
- Update `schema.ts` to re-export them from the new leaf, keeping a local
  `import type { SchemaOptions }` for use in `SchemaProducerContext`.
- Update `checks/types.ts` to import the two aliases from the leaf.
- Update `contract.ts` to import `SchemaUri` from `@anchr/protocol/schema`.

## Resolution

Implemented by updating:

- `packages/sdk/src/schema-options.ts` (new)
- `packages/sdk/src/schema.ts`
- `packages/sdk/src/proofs/verification/contract.ts`
- `packages/sdk/src/proofs/verification/checks/types.ts`

Verified with:

- `deno task lint:strict` — pass
- `deno task test:unit -- proofs` — 310 passed | 0 failed
- `deno task test:unit -- verification` — 310 passed | 0 failed

Harness update:

- None — `lint:arch` already forbids new import cycles in `packages/`; this
  issue removes one of the legacy SCCs and the remaining
  `requests/application` cycle is tracked separately.

Review residuals:

- None.

Follow-up:

- Break the remaining `requests/application` cycle in a separate issue.
