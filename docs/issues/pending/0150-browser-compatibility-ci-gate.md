# Browser-compatibility gate for the portable SDK surface

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0149

Blocks:
- 0143

## Summary

Portability currently has no drift-lock: nothing fails when a
`Deno.*` call, `node:*` import, or server-only dependency lands in a module
that the browser surface must reach. Add an automated gate that bundles (or
type-checks with a browser lib target) the portable subset of `@anchr/sdk`
plus `@anchr/protocol` and fails on any runtime-specific reference, wired
into `lint:strict` or the test chain.

## Rationale

- Phase C of 0143 makes the SDK browser-capable; without a deterministic
  check the property erodes immediately (`docs/review-harness.md` routes
  recurring findings to automated checks — this is the automated owner for
  the portability class).
- The repo already has the pattern: `scripts/arch-lint.ts` enforces import
  boundaries; this gate extends it to runtime-API boundaries, or uses a
  bundler dry run against a browser entrypoint.

## Acceptance

- A `deno task` exists that fails when the portable surface references
  `Deno.*`, `node:*`, or server-only adapters, and passes on the current
  (post-0149) tree.
- The task runs in `lint:strict` or `test:all` so the pre-commit/pre-push
  hooks enforce it.
- The portable surface (which entrypoints must stay browser-safe) is
  documented in `docs/architecture.md`.

## Verification

- Introducing a deliberate `Deno.env.get` into a portable module makes the
  gate fail; reverting makes it pass.
- `deno task lint:strict` passes on the clean tree.

## Plan

- Decide mechanism: esbuild/`deno bundle` dry run with a browser condition,
  or an arch-lint rule class (E0xx) over the portable module set.
- Define the portable entrypoint list with 0149's port boundaries.
- Wire into `lint:strict` and document in `docs/architecture.md`.
