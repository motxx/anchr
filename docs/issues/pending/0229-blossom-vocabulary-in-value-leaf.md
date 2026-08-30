# Decide Blossom's place in the neutral attachment value objects

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

`values.ts` presents itself as the transport-neutral shared value-object leaf,
but its shapes hardcode one attachment backend: `AttachmentRef` carries
`blossom_hash`/`blossom_servers`, and `BlossomKeyMaterial`/`BlossomKeyMap` are
Blossom-named key material re-exported from the root surface. The upload
interface leaks the backend the same way (error copy naming Blossom, hardcoded
`storage_kind: "blossom"`, `UploadResult.encryption` typed as
`BlossomKeyMaterial`). ADR 0001 fixes the v0 substrates to Nostr and Cashu;
whether Blossom is similarly a fixed v0 attachment substrate (making these
names shared protocol vocabulary) or an implementation detail behind a neutral shape
is undecided. Decide once and make the value objects and upload surface
conform.

## Rationale

- `packages/sdk/src/values.ts:17-37`: `AttachmentRef.blossom_hash`,
  `AttachmentRef.blossom_servers`, `BlossomKeyMaterial`, `BlossomKeyMap`; the
  file header (`:1-9`) declares it the shared leaf; re-exported at
  `index.ts:104-110`.
- `packages/sdk/src/attachments/upload.ts:50-52` ("Blossom is not configured.
  Set BLOSSOM_SERVERS…"), `:26` (`UploadResult.encryption: BlossomKeyMaterial`),
  `:128` (`storage_kind: "blossom"`), `:131-133`.
- `docs/architecture.md` ("Surface Policy") keeps Blossom under the SDK
  attachment API but does not state whether the protocol message
  `AttachmentRef` shape is Blossom-fixed; `AttachmentStorageKind` implies
  multiple kinds while only one exists.

## Acceptance

- A recorded decision: either Blossom is the fixed v0 attachment substrate and
  the value-object naming is documented as intentional (architecture.md or an
  ADR if it meets the ADR bar), or the shared value objects and the upload
  result/error surface are renamed to a transport-neutral shape with Blossom
  specifics confined to the Blossom module.
- Code and docs agree with the decision.

## Verification

- If neutralizing: `rg "blossom" packages/sdk/src/values.ts` returns no
  matches (expected); attachments tests pass.
- If fixing the substrate: the owning doc states it and this issue's
  resolution links it.

## Plan

- Decide fixed-substrate vs neutral-shape; apply to `values.ts`, `upload.ts`,
  and the root re-exports; update docs.
