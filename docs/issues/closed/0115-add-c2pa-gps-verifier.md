# Add C2PA GPS verifier

Created: 2026-06-11
Completed: 2026-06-11
Model: GPT-5 Codex

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Add a production-ready C2PA manifest signature + GPS binding verifier and
promote the corresponding invariant after the implementation is strong enough
to support public v0-plus claims.

## Rationale

The production readiness audit recorded the v0 decision to remove C2PA/GPS as a
built-in public schema because the repository does not currently have a native
`crates/` C2PA verifier or a threat-model invariant for manifest signature and
GPS binding. The SDK still has photo/integrity helper code, but that helper
surface is not a stable built-in proof schema contract.

Relevant current-state references:

- `docs/production-readiness-audit.md` F-02
- `docs/threat-model.md`
- `specs/proof-schemas.md`
- `packages/sdk/src/proofs/c2pa-validation.ts`
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts`

## Acceptance

- A C2PA manifest signature verifier with explicit GPS binding semantics exists
  in the appropriate runtime owner.
- `INV-06` is promoted to `docs/threat-model.md` with Claim, Attack, Expected,
  Tests, Status, and lock-file entry.
- A built-in C2PA/GPS proof schema URL is advertised only after the verifier and
  invariant are implemented and tested.
- Public README, package README, specs, protocol schema constants, and
  `spec-site/` agree on the promoted public surface.

## Verification

- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`
- Negative check before promotion should have no public built-in schema matches:
  `rg -n "c2pa-image|INV-06" README.md packages/protocol/src specs spec-site docs/threat-model.md`

## Plan

- Re-read the current SDK photo/integrity helpers and decide whether a native
  verifier crate, SDK helper, or external verifier port owns the load-bearing
  signature and GPS binding check.
- Add the verifier and attack tests before reintroducing any public built-in
  schema URL.
- Promote `INV-06` only after the attack test proves manifest-signature and GPS
  binding failure modes.

## Resolution

Implemented C2PA/GPS as a promoted built-in proof surface backed by SDK
verification code instead of a deferred placeholder:

- Added `verifyC2paGpsBinding()` in
  `packages/sdk/src/proofs/c2pa-validation.ts`, which fails closed when the
  C2PA verifier is unavailable, the active manifest is missing, the manifest
  signature is invalid, signed GPS is missing, or signed GPS is outside the
  accepted distance window.
- Routed photo-integrity verification through the C2PA GPS-binding helper when
  an expected GPS policy exists.
- Bound the `c2pa` verification factor to evidence presence: when `c2pa` is a
  required factor and the submission carries no verifiable image, photo-integrity
  now fails closed instead of passing on a non-image attachment.
- Added `INV-06` tests for invalid signatures, missing signed GPS, and
  out-of-range signed GPS, plus verifier-path coverage that body GPS cannot
  substitute for missing C2PA-signed GPS.
- Promoted `INV-06` in `docs/threat-model.md` and updated
  `docs/threat-model.lock.json`.
- Reintroduced `ProofSchema.C2paImageV1`, the C2PA proof schema spec-site
  page, public README/package README/spec references, and the `c2pa`
  verification factor.

Verification run during resolution:

- `deno test -A packages/sdk/src/proofs/c2pa-validation.test.ts packages/sdk/src/proofs/verification/verifier.test.ts packages/protocol/src/schema.test.ts packages/sdk/src/schema.test.ts`
- `deno task lint:invariants`
- `deno task lint:proof-schema-pages`
