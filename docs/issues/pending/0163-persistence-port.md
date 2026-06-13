# Inject a persistence port instead of direct Deno file I/O

Created: 2026-06-13
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0149
- 0150

## Summary

Child of 0149 (persistence port). The SDK persists state through direct Deno
filesystem calls, which have no browser equivalent. Put persistence behind an
injectable port with a filesystem server adapter (current behavior) so a browser
host can supply IndexedDB or a caller store. `adapters/storage.ts` already shows
the pattern to follow.

Current direct Deno file I/O (non-test):

- `packages/sdk/src/payments/cashu/preimage-store.ts` — synchronous
  `Deno.readTextFileSync` / `Deno.writeTextFileSync` (and `Deno.errors.NotFound`).
- `packages/sdk/src/payments/frost/frost-config.ts` — file-based FROST config
  loading.
- `packages/sdk/src/internal/runtime/fs.ts` — the async fs compat helper
  (`Deno.readFile` / `writeFile` / `stat`) backing the above; becomes the server
  adapter.

## Rationale

- Premise: the SDK must run in browser and server. Synchronous file I/O in the
  preimage store and file-based FROST config are hard browser blockers.
- A persistence port with a filesystem adapter keeps server behavior unchanged
  while letting a browser host inject an alternative store.

## Acceptance

- A persistence port exists with a filesystem (server) adapter; the preimage
  store and FROST config loading consume the port rather than calling `Deno`
  file APIs directly.
- No direct `Deno.read*/write*/rename*/stat` file calls remain outside the
  filesystem adapter in `internal/runtime/` and server entrypoints.

## Verification

- No matches are expected outside the fs adapter and server entrypoints:
  `rg "Deno\.(readTextFileSync|writeTextFileSync|renameSync|readFileSync|writeFileSync|readFile|writeFile|writeTextFile|mkdir)" packages/sdk/src --glob '!**/testing/**'`
- `deno task check`, `deno task lint:strict`, `deno task test:all` pass
  (preimage-store and FROST config behavior unchanged on the server adapter).

## Plan

- Define the persistence port + filesystem adapter (build on
  `internal/runtime/fs.ts` and `adapters/storage.ts`).
- Convert `preimage-store.ts` to async port usage and inject the store; thread
  the port into FROST config loading.
