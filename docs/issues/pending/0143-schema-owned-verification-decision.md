# Decide: schema-owned verification as the single dispatch model

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0142
- 0145
- 0146
- 0147

## Summary

The SDK has two competing verification taxonomies:

1. **Schema-URL dispatch** — open `SchemaUri` strings
   (`packages/protocol/src/schema.ts`), resolved through
   `resolveProofGenerator` / `resolveVerifierAdapter`
   (`packages/sdk/src/schema.ts:37-49`) by `canHandle(uri)`. Extensible.
2. **Factor checks** — the closed `VerificationFactor` union
   (`packages/sdk/src/values.ts:22-31`: `nonce`, `gps`, `timestamp`,
   `oracle`, `ai_check`, `tlsn`, `c2pa`), defaulting to `["gps",
   "ai_check"]` (`values.ts:33-36`), executed by the static
   `defaultFactorChecks` array
   (`packages/sdk/src/proofs/verification/checks/registry.ts:14-20`).
   Closed: a new factor requires editing the union and the registry.

Decide and record the target model before the Phase B implementation issues
land. Proposed target: **the schema URL is the only dispatch key.** A proof
schema owns its requirement shape, its evidence shape, its checks, and its
verdict details; "factors" become schema-internal vocabulary, not a shared
SDK enum. The shared verification contract carries only schema-neutral
fields plus a schema-scoped opaque payload.

## Rationale

- The user-facing premise is "anyone can define and implement a schema at an
  arbitrary URL". Today a third party can register a `VerifierAdapter`, but
  cannot express its requirement/evidence in `VerificationRequirement` /
  `VerificationInput` (TLSN/GPS fields are hardcoded,
  `packages/sdk/src/proofs/verification/contract.ts:35-46`) and cannot add a
  factor without editing `values.ts`.
- The factor union also forces schema-specific knowledge into the `Query`
  aggregate (`packages/sdk/src/requests/domain/types.ts:46,57-59,210`).
- This is a `human universal decision` per `docs/universality-boundaries.md`:
  it changes the evidence-contract boundary between protocol, SDK, and
  third-party implementations. Record the outcome in
  `docs/architecture.md` (evidence contract row) and, if wire-visible, in
  `specs/proof-schemas.md`.

## Acceptance

- A written decision (architecture doc + this issue's resolution) states the
  single dispatch model, what happens to `VerificationFactor`,
  `DEFAULT_VERIFICATION_FACTORS`, and the factor-check registry, and how
  built-in schemas (TLSN, C2PA) express their current factor semantics
  (nonce, timestamp, GPS distance) inside their own schema modules.
- Implementation issues 0145/0146/0147 are confirmed or re-scoped against
  the decision.

## Verification

- `docs/architecture.md` describes the decided evidence-contract model.
- Decision recorded; no code change required by this issue. Negative check
  once the phase completes: `rg "VERIFICATION_FACTORS" packages/` —
  no shared closed union is expected to remain.

## Plan

- Write the decision with the trade-offs (open string factors vs
  schema-scoped payloads vs hybrid).
- Confirm what stays wire-compatible: how requirement/evidence payloads are
  serialized into the existing encrypted execution payload and result events.
- Update `specs/proof-schemas.md` if the schema contract gains a
  requirement/evidence payload definition.
