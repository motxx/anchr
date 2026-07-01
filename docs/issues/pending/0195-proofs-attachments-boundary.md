# Move proof verification out of attachments and split photo-integrity per schema

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Proof-verification logic leaks into the attachment-transport feature, and one
"photo-integrity" check owns three unrelated evidence formats plus a
cross-feature attachment fetch. This violates the one-schema-one-owner rule and
couples proof verification to attachment transport internals, so an "upload"
change can alter verification behavior.

## Rationale

- `packages/sdk/src/attachments/upload.ts` (~lines 7-9, 63, 109) parses
  ProofMode zips and validates EXIF, then writes integrity records.
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts` (422 lines)
  owns C2PA (~91-139), ProofMode (~141-174), and EXIF (~220-266) verdicts and
  reaches three levels up into `../../../attachments/fetch-attachment.ts`
  (~line 23).
- `docs/architecture.md` ("Schema-Owned Verification") assigns each schema its
  own checks; transport and verification have different owners.
- Additional evidence (2026-07-02 architecture review): the leak is
  bidirectional. Verification → attachments is the single edge
  `photo-integrity.ts:23` (`fetchAttachmentData`, awaited at ~:343 — Blossom
  download + decrypt runs inside the check). Attachments → proofs is three
  edges: `upload.ts:5-14` plus `upload-helpers.ts:6`, with integrity-store
  writes at `upload.ts:80-87` and ProofMode zip parsing at `:109`. No
  injected attachment-fetch port exists yet.

## Acceptance

- ProofMode/EXIF/C2PA extraction lives in the owning proof-schema modules; the
  attachment upload path emits raw bytes only.
- `photo-integrity` no longer imports attachment transport directly; it uses an
  injected attachment-fetch port.

## Verification

- `rg "parseProofModeZip|validateExif" packages/sdk/src/attachments` returns no
  matches.
- `photo-integrity.ts` has no relative import into `attachments/`.

## Plan

- Move per-evidence extraction into schema modules.
- Introduce an attachment-fetch port and inject it into the checks.
