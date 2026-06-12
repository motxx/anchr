# Runtime schema registration with TLSN/C2PA as reference adapters

Created: 2026-06-12
Model: Claude Fable 5

## Priority

feature

## Dependencies

Depends on:
- 0144
- 0146

Blocks:
- 0143

## Summary

Make "add a proof schema" a single registration call against a public SDK
API, and make the built-in TLSN and C2PA implementations consume that same
API as reference adapters. Today the dispatch entry points are open
(`resolveProofGenerator` / `resolveVerifierAdapter`,
`packages/sdk/src/schema.ts:37-49`) but everything behind them is wired
statically:

- `packages/sdk/src/proofs/verification/checks/registry.ts:14-20` — static
  check array, no runtime registration.
- `packages/sdk/src/provider-types.ts:69-70` — `notary?: string` is
  TLSN-only provider configuration; there is no schema-scoped options slot.
- `scripts/check-proof-schema-pages.ts:9-17` — the schema-page lint
  hardcodes the two built-in URLs; a third-party schema URL has no
  manifest to join.
- 0141 (injectable proof-check dependencies) tracks the same module-level
  singletons (c2patool path cache, integrity store) that block per-schema
  injection.

## Rationale

- The premise is that TLSN and C2PA are merely the default schemas; the test
  of the design is whether they can be implemented purely through the public
  extension surface. Shipping them as reference adapters proves the API and
  keeps schema knowledge out of core.
- Schema-specific configuration (notary URL, c2patool path, verifier binary
  location) must ride a schema-scoped options map, not named SDK options.

## Acceptance

- A documented public API exists to register a schema implementation
  (producer + verifier + its checks/config) keyed by schema URI, usable
  without editing `packages/`.
- TLSN and C2PA register through that API; no core module imports their
  internals directly.
- `provider-types.ts` has no `notary` field; schema options are passed per
  schema URI.
- `scripts/check-proof-schema-pages.ts` reads a manifest (e.g.
  `spec-site/schemas.json`) instead of a hardcoded list.
- An e2e or example demonstrates a custom schema URI verified end to end
  with an out-of-tree producer/verifier pair.

## Verification

- No matches are expected: `rg "notary" packages/sdk/src/provider-types.ts`
- No matches are expected outside the schema modules:
  `rg -i "tlsn|c2pa" packages/sdk/src --glob '!**/proofs/**' --glob '!*.test.ts'`
- `deno task test:all` passes; `deno task lint:proof-schema-pages` passes
  against the manifest.

## Plan

- Design the registration shape with 0144's decision (likely: a schema
  bundle object {uri, producer, verifier, checks, configSchema}).
- Convert TLSN, then C2PA, to reference adapters; fold 0141's injection
  work into the bundle construction.
- Add the spec-site manifest and update the lint script.
