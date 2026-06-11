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

Completed: 2026-06-12

## Resolution

Implemented by updating:

- `packages/sdk/src/proofs/verification/contract.ts` (new: `VerificationRequirement`,
  `VerificationInput`, `VerificationDetail`; imports only the `values.ts` leaf
  and proofs-internal TLSN types — cycle-free)
- `packages/sdk/src/proofs/verification/index.ts` re-exports the contract +
  `VerifyProofOptions`/`FactorCheck`, so they flow to `@anchr/sdk/proofs`
- `packages/sdk/src/requests/domain/types.ts` (definitions removed; `Query`
  imports `VerificationDetail` from `proofs/mod.ts`)
- proofs-internal importers (`verifier.ts`, `checks/types.ts`, `checks/gps.ts`,
  `checks/tlsn.ts`) repointed to `./contract.ts`
- external importers (`payments/frost/frost-signer.ts`,
  `adapters/oracle-service/frost-signer-routes.ts`, `requests/` lifecycle files,
  `requests/domain/oracle-types.ts`, tests) repointed to `proofs/mod.ts`
- `scripts/arch-lint.ts` widened the request→proofs exception from
  `requests/domain/` to all of `requests/` (the lifecycle depends on the
  verification result type)

Verified with:

- `deno task check`, `deno task test:all`, `deno task lint:strict`
- `deno eval` confirming `VerificationRequirement`/`VerificationDetail` are
  nameable from `packages/sdk/src/proofs/mod.ts` (the `@anchr/sdk/proofs` entry)
- Negative: no `proofs/` file imports `Verification*` from `requests/domain`

Harness update:

- Boundary enforced by the arch-lint guard tracked in issue 0132.

Review residuals:

- The verification contract module is cycle-free. One residual
  `proofs → requests/domain` import remains: `verifier.ts`'s `Query`/`QueryResult`
  for the `verify`/`requestToRequirement`/`resultToVerificationInput` adapters
  (a pre-existing, type-only coupling). Relocating those to `requests/` —
  removing the last cycle and the public `Query` leak — is split out as
  issue 0133, which 0122 and 0132 now depend on.

Follow-up:

- 0133 (relocate verifier Query-adapters), then 0132 (arch-lint guard).
