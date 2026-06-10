# Split proof verifier into a validator registry

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`packages/sdk/src/proofs/verification/verifier.ts` (≈550 lines) knows every
proof type (C2PA, TLSN, EXIF, ProofMode, geo, AI-content), imports ~10
validators directly, and grows with each new proof schema. Move the
validators behind the existing `VerifierAdapter` seam
(`packages/sdk/src/schema.ts`) so the verifier core only resolves and runs
registered validators, and adding a proof type becomes one validator file
plus one registration.

## Rationale

Single-purpose design gate in `CLAUDE.md`. The `VerifierAdapter`/
`ProofGenerator` seam is already designed for multiple implementations; the
verifier bypasses it with direct imports. The `verify()` pass-through wrapper
and the `_setValidateTlsnForTest` seam (#0110) fold into this split.

## Acceptance

- The verifier core states one responsibility: requirement → resolve
  registered validator(s) → run → aggregate verdict.
- Proof-type-specific logic lives in per-validator modules registered through
  the schema seam; the core imports no concrete validator directly.
- Existing verification tests pass through the public interface.

## Verification

- `deno task test:unit`
- `deno task test:e2e:tlsn` (Docker)
- `deno task lint:arch`

## Plan

- Coordinate with #0110 (test-seam injection) so the TLSN validator override
  becomes a registry entry rather than a module global.

## Resolution

Implemented by updating:

- `packages/sdk/src/proofs/verification/checks/` — one module per
  verification factor: `empty-submission.ts`, `gps.ts`, `tlsn.ts`,
  `photo-integrity.ts` (C2PA/ProofMode/EXIF + attachment retrieval),
  `ai-content.ts`; `registry.ts` assembles `defaultFactorChecks`;
  `types.ts` owns the `FactorCheck`/`FactorCheckContext`/
  `VerifyProofOptions` contract.
- `proofs/verification/verifier.ts` — the core is now one sentence:
  resolve the registered factor checks, run them over requirement+evidence,
  aggregate the verdict. It imports no concrete validator; adding a factor
  is one check module plus one registry entry. `verifyProof` accepts an
  optional check list; `verify`/`requestToRequirement`/
  `resultToVerificationInput` keep their signatures.

Resolution note: the issue named the `VerifierAdapter` seam in `schema.ts`,
but that seam is the Customer-side per-schema proof checker. The Oracle-side
verifier dispatches on verification FACTORS that compose per requirement,
not on schemas — so the registry is a factor-check registry in
`proofs/verification/checks/`, and the schema seam remains the Customer-side
dispatch. Coordinated with #0110: the TLSN validator override flows through
`VerifyProofOptions.validateTlsn` into the tlsn check.

Verified with:

- `deno task test:all` (verifier tests pass unchanged through the public
  interface)

Harness update:

- None — existing verifier tests lock the behavior; the registry makes the
  extension point explicit.

Review residuals:

- None

Follow-up:

- None
