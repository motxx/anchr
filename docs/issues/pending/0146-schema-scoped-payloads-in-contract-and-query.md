# Replace hardcoded TLSN fields with schema-scoped payloads

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0144

Blocks:
- 0143
- 0147
- 0148

## Summary

The schema-neutral verification contract and the `Query` aggregate hardcode
TLSNotary-specific fields, so a third-party schema cannot carry its own
requirement or evidence without forking. Replace them with schema-scoped
payloads keyed by the request's schema URI, per the model decided in 0144.

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
  schema requirement/evidence/verdict data travels in schema-scoped payload
  fields.
- TLSN keeps working end to end as the first consumer of the new payload
  fields (e2e tlsn bucket green).
- Wire serialization of execution payloads and results is either unchanged
  or versioned per `specs/` rules.

## Verification

- No matches are expected:
  `rg "tlsn" packages/sdk/src/proofs/verification/contract.ts packages/sdk/src/requests/`
- `deno task test:all` passes; `deno task test:e2e:tlsn` passes with the
  Rust toolchain.

## Plan

- Introduce the schema-scoped payload fields decided in 0144.
- Move the TLSN field shapes into the TLSN schema module; convert
  `query-verifier.ts` mappings to pass payloads through opaquely.
- Update `specs/` if the encrypted payload layout changes.
