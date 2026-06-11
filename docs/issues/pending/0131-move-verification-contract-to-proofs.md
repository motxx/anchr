# Move the proof-verification contract to proofs and expose it publicly

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0130

Blocks:
- 0122

## Summary

Move the proof-verification I/O contract out of `requests/domain/types.ts` into
a `proofs/`-owned module and re-export it from `@anchr/sdk/proofs`, so the public
`verifyProof`/`verify` signatures become nameable without importing from
`@anchr/sdk/testing`. Depends on 0130 (the shared vocabulary must already live in
the neutral leaf module, otherwise this move recreates the
`proofs ↔ requests/domain` type cycle).

## Rationale

Parent: issue 0122 (A-full direction).

In scope: `VerificationRequirement`, `VerificationInput`, `VerificationDetail`,
`VerifyProofOptions` (currently at `packages/sdk/src/requests/domain/types.ts:118-148`
and `packages/sdk/src/proofs/verification/checks/types.ts:23`).

These are the verifier's input/output contract — `verifyProof(requirement,
input, options): VerificationDetail` is a standalone proof engine usable without
a `Query` (see `verifier-standalone.test.ts`), so per `docs/architecture.md`
the type belongs in the owning feature directory (`proofs/`). After 0130, these
types reference only the neutral-leaf vocabulary and `proofs/tlsn-types.ts`, so
proofs can own them with a one-directional `requests/domain → proofs` import for
the embedding `Query.verification` / `Query.blossom_keys` fields.

## Acceptance

- `VerificationRequirement`, `VerificationInput`, `VerificationDetail`,
  `VerifyProofOptions` live in a `proofs/`-owned module and are exported from
  `@anchr/sdk/proofs`.
- `requests/domain/types.ts` no longer defines them; the `Query` aggregate
  imports `VerificationDetail` from `proofs` in one direction.
- A consumer importing only non-`/testing` subpaths can name every public
  `verifyProof`/`verify` parameter and return type.

## Verification

- `deno task check`
- `deno task test:all`
- `deno task lint:strict`
- A `deno check` on a sample `examples/`-style consumer that imports only
  `@anchr/sdk` / `@anchr/sdk/proofs` and annotates a `VerificationRequirement`
  and `VerificationDetail` compiles.
- No matches expected:
  `rg -n "VerificationRequirement|VerificationInput|VerificationDetail" packages/sdk/src/requests/domain/types.ts`

## Plan

- Create the proofs verification-contract module; move the four types in.
- Re-export them through `proofs/verification/index.ts` → `proofs/mod.ts` →
  `@anchr/sdk/proofs`.
- Repoint importers (`requests/`, `adapters/`, `payments/frost/`, the verifier
  and its tests) to the proofs module.
- Confirm no `proofs ↔ requests/domain` type cycle remains (0130 prerequisite).
