# Prune the dead attachments access/StoredAttachment cluster

Created: 2026-07-03
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

A three-file cluster in `attachments/` is reachable only through the public
barrel and has no consumers anywhere: `access.ts` (174 lines, 12 exports —
`materializeResultAttachments`, `resolveStoredAttachment`,
`readStoredAttachmentAsBase64`, …) is imported only by `attachments/mod.ts`;
`attachment-helpers.ts` is imported only by `access.ts`; the
`StoredAttachment*` interfaces in `attachments/types.ts` are consumed only
inside the cluster and leak the Node `Buffer` type into a public interface
(`StoredAttachmentBuffer`). This is the same dead-abstraction disease 0228
prunes in `requests/`, in a different organ. Delete the cluster (or record
why any part stays), re-verifying deadness against the tree at resolution
time.

## Rationale

- Importer graph verified 2026-07-03: `access.ts` ← `mod.ts` only;
  `attachment-helpers.ts` ← `access.ts` only; no symbol usage across
  `packages/`, `e2e/`, `examples/`, `scripts/`.
- `attachments/types.ts:1` `import type { Buffer } from "node:buffer"` on a
  publicly exported interface (see 0237 for the wider Buffer question).
- `attachments/mod.ts` is the public `@anchr/sdk/attachments` subpath, so
  these are advertised API — check README/docs references before deleting.
- 0195 moves proof-verification out of `attachments/`; resolve coherently
  with it if both are in flight.

## Acceptance

- The cluster is deleted (and `mod.ts`/docs updated), or each retained file
  has a named consumer or recorded reason in the resolution note.
- No publicly exported attachment symbol is consumer-less afterwards.

## Verification

- `rg "materializeResultAttachments|resolveStoredAttachment|StoredAttachment" packages e2e examples scripts`
  returns no matches (expected after deletion).
- `deno task lint:strict`, `deno task test:unit`, and
  `deno task publish:dry-run` pass.

## Plan

- Re-verify liveness with `rg`; delete or justify per file; update the
  barrel and any doc references.
