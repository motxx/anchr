# Scope integrity-store lookups to the request to stop cross-request replay

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`verifyPhotoIntegrity` looks up integrity records by the provider-chosen
attachment id only, ignoring the record's `requestId`, and when a record is
found it trusts the stored C2PA/EXIF verdict and skips re-validating the
submitted image. With a process-wide default store, a passing record from one
request can be replayed to satisfy a different request that submits no real
evidence.

## Rationale

- `packages/sdk/src/proofs/integrity-store.ts` (~lines 54-56): `get(att.id)`
  keyed only on attachment id; default store is a process-wide singleton
  (~line 79).
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts` (~lines
  281-323): trusts a found record and skips real validation.
- Relates to INV-06 (C2PA GPS binding).

## Acceptance

- The primary lookup is scoped to `requestId` (or records are keyed by content
  hash), and a record whose `requestId` differs from the query under
  verification is never served.

## Verification

- Unit test: a record stored for request A is not accepted when verifying
  request B that references the same attachment id.

## Plan

- Key/scoped-lookup integrity records by `requestId` and/or content hash.
- Fall back to real validation when no request-scoped record exists.
