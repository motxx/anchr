# Minor sweep: duplicated bytesToHex and index.ts/mod.ts barrel naming

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

Two small, independent findings from the 2026-07-03 architecture review;
resolve or explicitly decline per item.

1. `packages/sdk/src/test-helpers.ts` hand-rolls `bytesToHex` while
   `identity.ts` imports the same function from the existing
   `@noble/hashes/utils.js` dependency — one byte-hex owner should remain.
2. Barrel naming is inconsistent: nearly every directory uses `mod.ts`,
   but `adapters/oracle-client/index.ts` and
   `adapters/oracle-service/index.ts` use `index.ts` (the package root
   `src/index.ts` is the publish entry and may keep its name). Renaming
   requires updating the matching `deno.json` `exports` entries.

## Rationale

- `test-helpers.ts:9-15` vs `identity.ts:11` (`bytesToHex` from
  `@noble/hashes/utils.js`).
- `ls packages/sdk/src/**` (2026-07-03): `mod.ts` everywhere except the two
  adapter directories and the root entry.
- Related: 0224 touches `adapters/` layout; coordinate if both in flight.

## Acceptance

- One `bytesToHex` definition remains in `packages/sdk/src` (the @noble
  import), or the duplicate is justified in the resolution note.
- Directory barrels use one naming convention, with the root publish entry
  as the only recorded exception; `deno.json` exports point at the renamed
  files.

## Verification

- `rg "function bytesToHex" packages/sdk/src` returns no matches
  (expected — only the @noble import remains).
- `deno task lint:strict`, `deno task test:unit`, and
  `deno task publish:dry-run` pass.

## Plan

- Swap the hand-rolled helper for the @noble import.
- Rename the two adapter barrels to `mod.ts`; update `deno.json` exports.
