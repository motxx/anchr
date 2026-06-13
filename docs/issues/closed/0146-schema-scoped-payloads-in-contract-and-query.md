# Replace hardcoded TLSN fields with schema-scoped payloads

Created: 2026-06-12
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143
- 0147
- 0148

## Summary

The schema-neutral verification contract and the `Query` aggregate hardcode
TLSNotary-specific fields, so a third-party schema cannot carry its own
requirement, evidence, or verifier details without forking. Replace them with
schema-scoped payloads keyed by the request's schema URI, per the model decided
in 0144.

Current hardcoding:

- `packages/sdk/src/proofs/verification/contract.ts:38,45-46,56` —
  `tlsn_requirements`, `tlsn_attestation`, `tlsn_extension_result`,
  `tlsn_verified` on `VerificationRequirement` / `VerificationInput` /
  `VerificationDetail`, importing TLSN types into the contract module.
- `packages/sdk/src/requests/domain/types.ts:46,57-59,172,210` — the same
  fields on `QueryInput`, `QueryResult`, `OracleAttestationRecord`, `Query`.
- `packages/sdk/src/requests/application/query-verifier.ts:26,36-37` — the
  `Query`→contract adapters map the TLSN fields explicitly.

## Rationale

- This is the load-bearing blocker for the "anyone can define a schema"
  premise; see the 0144 decision record.
- The contract module's own header says it should depend only on the shared
  value leaf, yet it imports `proofs/tlsn-types.ts`.
- Schema implementations remain free to define precise types; the core
  carries them opaquely (validated at the schema boundary with type
  predicates — `as`/`any` stay forbidden).

## Acceptance

- `VerificationRequirement` / `VerificationInput` / `VerificationDetail` and
  `QueryInput` / `QueryResult` / `Query` contain no schema-named fields;
  schema requirement, evidence, and verdict-detail data travels in
  schema-scoped payload fields.
- TLSN keeps working end to end as the first consumer of the new payload
  fields (e2e tlsn bucket green).
- Wire serialization uses the existing encrypted v0 slots documented in
  `specs/proof-schemas.md`: requirement payload in selection
  `execution.predicate`, evidence payload in result `data` / `proof`, and no
  shared factor field.

## Verification

- No matches are expected:
  `rg "tlsn" packages/sdk/src/proofs/verification/contract.ts packages/sdk/src/requests/`
- `deno task test:all` passes; `deno task test:e2e:tlsn` passes with the
  Rust toolchain.

## Plan

- Introduce the schema-scoped requirement, evidence, and verdict-detail payload
  fields decided in 0144.
- Move the TLSN field shapes into the TLSN schema module; convert
  `query-verifier.ts` mappings to pass payloads through opaquely.
- Keep encrypted payload field names aligned with `specs/proof-schemas.md` and
  version any future wire-shape change through `specs/`.

## Resolution

Implemented by updating:

- `e2e/tlsn/tlsn.test.ts`
- `packages/sdk/src/adapters/nostr/events/oracle-attestation.ts`
- `packages/sdk/src/adapters/nostr/oracle-handlers.ts`
- `packages/sdk/src/adapters/nostr/proof-publisher.ts`
- `packages/sdk/src/adapters/oracle-client/built-in.ts`
- `packages/sdk/src/proofs/tlsn-types.ts`
- `packages/sdk/src/proofs/verification/checks/tlsn.ts`
- `packages/sdk/src/proofs/verification/checks/types.ts`
- `packages/sdk/src/proofs/verification/contract.ts`
- `packages/sdk/src/proofs/verification/verifier-standalone.test.ts`
- `packages/sdk/src/proofs/verification/verifier-tlsn.test.ts`
- `packages/sdk/src/proofs/verification/verifier.test.ts`
- `packages/sdk/src/proofs/verification/verifier.ts`
- `packages/sdk/src/requests/application/proof-delivery.test.ts`
- `packages/sdk/src/requests/application/query-verification.test.ts`
- `packages/sdk/src/requests/application/query-verification.ts`
- `packages/sdk/src/requests/application/query-verifier.ts`
- `packages/sdk/src/requests/domain/oracle-types.ts`
- `packages/sdk/src/requests/domain/query-aggregate.test.ts`
- `packages/sdk/src/requests/domain/query-aggregate.ts`
- `packages/sdk/src/requests/domain/types.ts`
- `packages/sdk/src/requests/domain/value-objects.test.ts`
- `packages/sdk/src/requests/domain/value-objects.ts`
- `docs/issues/closed/0146-schema-scoped-payloads-in-contract-and-query.md`
- `docs/issues/pending/0147-move-gps-into-schema-owned-verification.md`
- `docs/issues/pending/0148-runtime-schema-registration-and-reference-adapters.md`

Verified with:

- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:integration`
- `rg 'tlsn' packages/sdk/src/proofs/verification/contract.ts packages/sdk/src/requests/` (no matches)
- `check-silent-bypass` review of changed package source files: no silent-bypass patterns detected

Harness update:

- Unit tests in `packages/sdk/src/proofs/verification/verifier-standalone.test.ts`, `packages/sdk/src/proofs/verification/verifier-tlsn.test.ts`, `packages/sdk/src/proofs/verification/verifier.test.ts`, `packages/sdk/src/requests/domain/query-aggregate.test.ts`, and `packages/sdk/src/requests/application/query-verification.test.ts` lock the schema-payload contract and TLSN boundary narrowing.
- The negative check `rg 'tlsn' packages/sdk/src/proofs/verification/contract.ts packages/sdk/src/requests/` now guards against reintroducing schema-named TLSN fields into the shared contract or request aggregate.

Review residuals:

- `deno task test:e2e:tlsn` was attempted after confirming Cargo and TLSN binaries were present and after starting `docker compose up -d tlsn-verifier`, but this local sandbox blocks connections to `localhost:7046` with `Operation not permitted`; rerun the TLSN e2e bucket in an environment that permits localhost verifier access.

Follow-up:

- 0147
- 0148
