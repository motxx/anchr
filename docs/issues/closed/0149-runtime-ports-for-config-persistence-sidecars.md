# Runtime ports for env config, persistence, and sidecar execution

Created: 2026-06-12
Model: Claude Fable 5
Completed: 2026-06-14

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

## Resolution

Tracking parent resolved by closing its four runtime-port children:

- 0162 — env-config port: feature modules take config through an injected port
  whose server adapter reads `Deno.env`; arch-lint E028 ENV_READ_ALLOWED shrunk
  to the config adapter + testing + the server entrypoint.
- 0163 — persistence port: the preimage store and FROST config loading consume
  a `PersistenceStore` port; the filesystem server adapter preserves the atomic
  temp-file + rename write.
- 0164 — sidecar-execution port: FROST CLI invocation + binary discovery consume
  a `SidecarExecutor` port; `Deno.Command` lives only in the execution adapter.
- 0165 — server-entrypoint split: `Deno.serve` + module-scope env reads moved to
  `adapters/oracle-service/server-entry.ts`; `buildOracleApp` stays a
  side-effect-free library export.

Verified with:

- Per child: `deno task check`, `deno task lint:strict`, `deno task test:unit`,
  and `deno task test:e2e:frost` for the settlement-touching ports (0163, 0164,
  0165).
- Direct-runtime-API guards now hold: `Deno.env`, `Deno.*` file I/O, and
  `Deno.Command` appear only in the documented `internal/runtime/` adapters and
  the server entrypoint (enforced by arch-lint E028 for env; 0150 adds the
  automated browser-surface gate).

Harness update:

- arch-lint E028 (env) plus the per-port negative `rg` guards lock the runtime
  ports; issue 0150 wires the deterministic browser-compatibility gate that
  fails on any `Deno.*` / `node:*` reference in the portable surface.

Review residuals:

- None.

Follow-up:

- 0150 (browser-compatibility CI gate).
