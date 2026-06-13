# Inject a persistence port instead of direct Deno file I/O

Created: 2026-06-13
Model: Claude Fable 5
Completed: 2026-06-13

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

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/types.ts`
- `packages/sdk/src/adapters/storage.ts`
- `packages/sdk/src/internal/runtime/fs.ts`
- `packages/sdk/src/internal/runtime/mod.ts`
- `packages/sdk/src/payments/cashu/preimage-store.ts`
- `packages/sdk/src/payments/frost/frost-config.ts`
- `packages/sdk/src/adapters/oracle-service/server-entry.ts`
- `packages/sdk/src/adapters/nostr/hash-responder.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/requests/application/ports.ts`
- `packages/sdk/src/requests/application/verification-orchestration.ts`
- `packages/sdk/src/requests/application/escrow-flow-methods.ts`
- related unit and e2e tests for async preimage-store consumption.

Verified with:

- `rg "Deno\\.(readTextFileSync|writeTextFileSync|renameSync|readFileSync|writeFileSync|readFile|writeFile|writeTextFile|mkdir|statSync|stat)\\b" packages/sdk/src --glob '!**/testing/**'`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `deno task test:e2e:regtest` (blocked: local Cashu mint and lnd-user regtest infrastructure were not reachable)
- `check-silent-bypass` review of changed non-test package files

Harness update:

- The persistence rg guard now passes for `preimage-store.ts` and
  `frost-config.ts`; both consume the injected persistence store. Remaining
  `Deno.statSync` matches are FROST binary-discovery issue 0164 scope.

Review residuals:

- `deno task test:e2e:regtest` must be rerun with regtest infrastructure
  available (`docker compose up -d && ./scripts/init-regtest.sh && docker
  compose restart cashu-mint`).

Follow-up:

- None
