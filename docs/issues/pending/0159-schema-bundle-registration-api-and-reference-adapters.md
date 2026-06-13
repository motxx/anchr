# Public schema-bundle registration API with TLSN/C2PA as reference adapters

Created: 2026-06-13
Model: Claude Fable 5

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- 0148
- 0160
- 0161

## Summary

Core child of 0148. Introduce a public SDK API that registers a proof-schema
implementation keyed by schema URI, and convert the built-in TLSN and C2PA
implementations to consume that same API as reference adapters so no core
module outside the proof-schema modules carries schema knowledge.

Concretely:

- A documented schema-bundle shape (e.g. `{ uri, producer, verifier, checks,
  configSchema }`) registered through a public call, usable without editing
  `packages/`. The bundle owns the schema's requirement/evidence/verdict
  payload handling (the opaque `schema_requirement` / `schema_evidence` /
  `schema_verdict` payloads from 0146/0147) and its checks.
- TLSN and C2PA register through that API; the static
  `defaultFactorChecks` array (`packages/sdk/src/proofs/verification/checks/
  registry.ts`) becomes runtime registration.
- `notary` is removed from `packages/sdk/src/provider-types.ts` and
  `SchemaProducerContext.notary` from `packages/sdk/src/schema.ts`;
  schema-specific config (notary URL, c2patool path, verifier binary location)
  rides a schema-scoped options map keyed by schema URI.
- 0141's injectable proof-check dependencies (c2patool path cache, integrity
  store) fold into bundle construction rather than module-level singletons.

The manifest lint update and the custom-schema end-to-end demonstration are
split into 0160 and 0161 respectively.

## Rationale

- 0148's premise: TLSN and C2PA are merely the default schemas; the test of the
  design is whether they can be implemented purely through the public
  extension surface, proving schema knowledge is out of core.
- The monolithic 0148 resolution attempt was too large for one coherent
  verifiable change; this child owns the load-bearing decoupling.
- No public registration API accepts `VerificationFactor` values or shared
  default factor lists (per the 0144 decision; factors are schema-internal).

## Acceptance

- A documented public registration API exists to register a schema bundle
  (producer + verifier + payload handling + checks + schema-scoped config)
  keyed by schema URI, usable without editing `packages/`.
- TLSN and C2PA register through that API; no core module imports their
  internals directly.
- No public registration API accepts `VerificationFactor` values or shared
  default factor lists.
- `provider-types.ts` has no `notary` field; schema options are passed per
  schema URI.

## Verification

- No matches are expected: `rg "notary" packages/sdk/src/provider-types.ts packages/sdk/src/schema.ts`
- No matches are expected outside the schema modules:
  `rg -i "tlsn|c2pa" packages/sdk/src --glob '!**/proofs/**' --glob '!*.test.ts'`
- `deno task check`, `deno task lint:strict`, and `deno task test:unit` pass.
- TLSN and C2PA end-to-end paths stay green (`deno task test:e2e:tlsn` /
  the C2PA INV-06 tests) where the toolchain is available.

## Plan

- Design the bundle shape against the 0144 decision and the 0146/0147 opaque
  payloads.
- Convert TLSN, then C2PA, to reference adapters; fold 0141's injection into
  bundle construction.
- Replace the static factor-check registry with runtime registration.
- Remove `notary`; route schema config through the schema-scoped options map.
