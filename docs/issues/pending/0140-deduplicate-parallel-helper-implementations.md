# Deduplicate parallel helper implementations

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Three helpers are implemented in parallel with actual or imminent drift, each
needing one owner:

1. Per-query preimage hash issuance: `packages/sdk/src/adapters/nostr/oracle-service.ts`
   and `packages/sdk/src/adapters/oracle-service/htlc-routes.ts` both
   implement get-or-create against `queryHashMap`/`preimageStore`; lifecycle
   already diverges (the Nostr path deletes the entry after delivery, the
   HTTP routes never consume it).
2. Filename-to-MIME inference: `packages/sdk/src/attachments/access.ts`
   (extension table, `application/octet-stream` fallback) vs
   `packages/sdk/src/attachments/upload-helpers.ts` (regex for three types,
   `image/jpeg` fallback) — the same file gets different MIME types at upload
   and access time.
3. GPS distance-policy evaluation (haversine + threshold + message):
   `packages/sdk/src/proofs/c2pa-validation.ts`,
   `packages/sdk/src/proofs/verification/checks/gps.ts`, and
   `packages/sdk/src/proofs/exif-validation.ts`.

## Rationale

- Found by the `arch-lint-llm` review (L003) on 2026-06-12. Pre-existing
  structure. The three deduplications are independent; the resolver may close
  them in one change or split this issue.

## Acceptance

- Each concern has a single implementation; all former call sites delegate to
  it.

## Verification

- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Extract one owner helper per concern next to its closest existing module
  and delete the copies.
