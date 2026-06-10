# Split proof verifier into a validator registry

Created: 2026-06-10
Model: Claude Fable 5

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
