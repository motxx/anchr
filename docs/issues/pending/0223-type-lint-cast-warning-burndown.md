# Burn down the 251 type-safety lint cast warnings

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

`lint:types` currently passes with 251 warnings — each a plain `as` cast in
`packages/`. The type bar says casts should be narrowed with type predicates,
with a cast kept only at a real parser boundary justified by
`// type-lint-allow: <reason>`. 251 unreviewed casts is a large pool of
potential type laundering (several audit findings rode on exactly such
boundaries). This is a tracking issue: the resolver should re-read the current
warning list and split the burn-down (e.g. by package/module) before
implementation.

## Rationale

- CI log: `✓ type-safety lint passed (errors=0, warnings=251)`.
- AGENTS.md type bar: predicates over casts; justified casts only at parser
  boundaries.
- Security-relevant cast sites should be prioritised (payment, verification,
  protocol parsing paths).

## Acceptance

- The warning count is driven to zero: each cast is replaced with a narrowing
  predicate or explicitly justified with `// type-lint-allow: <reason>` at a
  genuine parser boundary.

## Verification

- `deno task lint:types` (via `lint:strict`) reports 0 errors and 0 warnings.

## Plan

- Generate the current warning list; split by module into child issues with
  `make-issues` if one pass is too large; start with payment/verification
  paths.
