# Dissolve the role types-annex files (customer-types.ts / provider-types.ts)

Created: 2026-07-03
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0191

Blocks:
- None

## Summary

`customer-types.ts` and `provider-types.ts` replicate at role level the
"remote type annex" shape 0224 dissolves for `adapters/types.ts`: each is a
side file of types consumed almost solely by its sibling role module and
`index.ts`, rather than a seam with its own owner responsibility. The
pattern is also asymmetric — oracle has no `oracle-types.ts`; its types
live in `oracle.ts`. When 0191 decomposes the role god-functions into named
steps, fold these annexes into the shape that decomposition produces (types
beside their owning step/module, or one consistent `<role>.ts`-owned
types section), and make the three roles uniform.

## Rationale

- `packages/sdk/src/customer-types.ts` (~100 lines; imported by
  `customer.ts`, `customer.test.ts`, `index.ts`),
  `provider-types.ts` (same shape); no `oracle-types.ts`.
- `customer-types.ts` imports ports from `adapters/types.ts` — 0224 will
  already retarget those imports; this issue owns the annex-file shape.
- Depends on 0191 because the post-decomposition module layout decides
  where role types belong; resolving earlier would move the same types
  twice.

## Acceptance

- Role option/result/error types live in one consistent, recorded place
  across Customer, Provider, and Oracle; no `<role>-types.ts` annex remains
  without a stated owner responsibility that another module could not hold.

## Verification

- `deno task lint:strict` and `deno task test:unit` pass after the fold.
- The three role modules follow the same file pattern (manual check
  recorded in the resolution note).

## Plan

- After 0191, inventory the annex types; co-locate them with their owners;
  update `index.ts` re-exports per 0225's classification.
