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

Completed: 2026-07-04

## Resolution

Resolved by the 0241 repo-wide dead-code purge on branch
`worktree-purge-dead-code` (commit 9b81e49), taking the acceptance's
"retained file has a named consumer" branch: the dead half of the cluster
was deleted; the surviving half is a live chain with real consumers. The
issue's premise "no symbol usage across packages/e2e/examples/scripts" was
over-broad — barrel-mediated consumers exist (verified 2026-07-04).

Deleted:

- `access.ts`: `materializeResultAttachments`,
  `readStoredAttachmentAsBase64`, `readStoredAttachmentBuffer`,
  `statStoredAttachment`
- `attachment-helpers.ts`: `readBlossomAttachment`,
  `readExternalAttachment`
- `types.ts`: `StoredAttachmentBuffer`, `StoredAttachmentStats`, and the
  `node:buffer` type import (the public-interface Buffer leak this issue
  and 0237 flagged)

Retained, with named consumers:

- `access.ts` — `materializeAttachmentRef` ←
  `examples/paid-request-simulation/mod.ts:18,65`;
  `normalizeResultAttachments` ← `e2e/regtest/regtest-cashu.test.ts:38,117`;
  `normalizeAttachmentRef`, `buildAttachmentAbsoluteUrl`,
  `attachmentPublicBaseUrl`, `resolveStoredAttachment`,
  `AttachmentAccessOptions`, `StoredAttachment` are that chain's tested
  internals (each consumed in-file by the live chain and/or unit tests) —
  no consumer-less export remains.
- `attachment-helpers.ts` ← `access.ts` (internal helpers of the live
  chain).
- `types.ts` `StoredAttachment` ← `access.ts` / `attachment-helpers.ts`
  signatures.

Verified with:

- `rg` per deleted symbol across `packages e2e examples scripts` — 0
  matches; per retained symbol — the consumers listed above
- `deno task test:all` and `deno task publish:dry-run` — pass on the
  purge branch

Harness update:

- None — the dead-cluster sweep method is recorded in 0241's resolution
  note; the remaining `node:buffer` usages and the port-lint extension
  stay owned by 0237.

Review residuals:

- Close is contingent on branch `worktree-purge-dead-code` (0241, commit
  9b81e49) merging to main; reopen if that branch is discarded.
- API-surface minimization of the retained exports (un-exporting
  chain-internal helpers) belongs to the 0224/0225 surface work.

Follow-up:

- 0237 (Buffer migration + lint), 0224/0225 (surface shape) — already
  pending.
