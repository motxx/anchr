# Runtime ports for env config, persistence, and sidecar execution

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0162
- 0163
- 0164
- 0165

Blocks:
- 0143
- 0150

This issue is now a tracking parent. After re-reading the call sites left by
Phase A/B deletions (0145, 0151, 0156, 0159), it splits into one child per
runtime port: 0162 (env-config port), 0163 (persistence port), 0164
(sidecar-execution port), and 0165 (server-entrypoint split). Its resolution is
the closure of those four children. The detail below is owned by them.

## Summary

Tracking issue: the SDK reads its runtime environment through three
hardcoded channels that block browser use. Put each behind an injectable
port with a server adapter (current behavior) and a browser adapter, then
split server-only entrypoints out of library modules. The resolver should
split this issue once 0145, 0151, and 0156 have decided which call sites still
exist.

1. **Env config** — `Deno.env.get` is called directly in
   `packages/sdk/src/internal/runtime/config.ts` and at feature call sites
   (`payments/cashu/cashu-wallet.ts:31`, `attachments/blossom.ts:36`,
   `adapters/nostr/oracle-service.ts:375-379`, others). Browsers have no
   env; config must be constructor-injected.
2. **Persistence** — `payments/cashu/preimage-store.ts:81-106` does
   synchronous file I/O (`Deno.readTextFileSync` / `writeTextFileSync` /
   `renameSync`); FROST config loading is file-based. Needs a persistence
   port (FS on server, IndexedDB or caller-supplied store in browser);
   `adapters/storage.ts` already shows the pattern.
3. **Sidecar execution** — schema verifiers and payment helpers spawn
   binaries via `Deno.Command` (`payments/frost/frost-cli.ts`,
   `proofs/tlsn-validation.ts`, `proofs/c2pa-validation.ts`,
   `proofs/proofmode-validation.ts`, `internal/runtime/which.ts`). The
   schema-bundle work in 0148 should make execution strategy a per-schema
   adapter concern (subprocess on server; remote verifier or WASM in
   browser), not a core capability.
4. **Server entrypoints** — `adapters/oracle-service/server.ts:150` calls
   `Deno.serve` inside a library module; bootstrap belongs in a separate
   entrypoint (final shape depends on 0156).

## Rationale

- Premise: the SDK must run in browser and server. `@anchr/protocol`,
  nostr-tools, cashu-ts, and the storage adapter are already portable; these
  three channels are the remaining blockers.
- `node:fs`/`node:os`/`node:path` imports in `proofs/` and `attachments/`
  fall away largely via 0145/0151; what remains follows the ports here.

## Acceptance

- No direct `Deno.env`, `Deno.read*/write*/rename*`, or `Deno.Command`
  usage outside the server-side port adapters and server entrypoints.
- A browser-targeted import of the Customer/Provider core modules resolves
  without `Deno.*` or `node:*` references (gate automated in 0150).

## Verification

- No matches are expected outside `internal/runtime/` adapters and server
  entrypoints: `rg "Deno\.(env|Command|readTextFileSync|writeTextFileSync|renameSync|serve)" packages/sdk/src`
- `deno task test:all` passes.

## Plan

- Resolver: re-read call sites after Phase A deletions, then split into
  one child per port (config, persistence, sidecar/verifier execution,
  entrypoint split).
