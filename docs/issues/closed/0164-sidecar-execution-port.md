# Inject a sidecar-execution port instead of direct Deno.Command spawns

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

Child of 0149 (sidecar execution port). The SDK spawns binaries directly via
`Deno.Command`, which cannot run in a browser. Make subprocess execution an
injectable strategy: a server adapter spawns processes (current behavior), and
the portable core does not reference `Deno.Command`. Per the 0148/0159
schema-bundle work, schema verifier execution (c2patool, tlsn binaries) is
already a per-schema concern; this issue routes the remaining spawn sites
through an injected executor so the portable surface is free of `Deno.Command`.

Current direct `Deno.Command` / process spawns (non-test):

- `packages/sdk/src/internal/runtime/process.ts` — the spawn compat helper
  (becomes the server executor adapter).
- `packages/sdk/src/internal/runtime/which.ts` — binary lookup via
  `Deno.Command("which")`.
- `packages/sdk/src/payments/frost/frost-cli.ts` — spawns the frost-signer
  binary (and `Deno.statSync` for binary discovery).

(TLSN/C2PA verifier spawns live behind the schema bundles from 0159; confirm
they consume the injected executor rather than spawning in core.)

## Rationale

- Premise: the SDK must run in browser and server. `Deno.Command` is a hard
  browser blocker; execution strategy must be injectable (subprocess on server;
  remote verifier or WASM in browser, supplied by the host/schema adapter).

## Acceptance

- A sidecar-execution port exists with a server (subprocess) adapter; FROST CLI
  invocation and binary lookup consume the port. Schema verifier execution rides
  the per-schema adapter from 0159, not a core `Deno.Command` call.
- No direct `Deno.Command` / `Deno.statSync`-for-binary-discovery remains
  outside the execution adapter in `internal/runtime/` and server entrypoints.

## Verification

- No matches are expected outside the execution adapter and server entrypoints:
  `rg "new Deno\.Command|Deno\.Command\(" packages/sdk/src --glob '!**/testing/**'`
- `deno task check`, `deno task lint:strict`, `deno task test:all` (including
  `test:e2e:frost`) pass — FROST signing behavior unchanged on the server
  executor.

## Plan

- Define the execution port + subprocess (server) adapter built on
  `internal/runtime/process.ts` and `which.ts`.
- Thread the executor into `frost-cli.ts`; confirm schema verifier execution
  uses the per-schema adapter rather than spawning in core.

## Resolution

Implemented by updating:

- `packages/sdk/src/internal/runtime/process.ts`
- `packages/sdk/src/internal/runtime/which.ts`
- `packages/sdk/src/internal/runtime/sidecar-execution.ts`
- `packages/sdk/src/internal/runtime/mod.ts`
- `packages/sdk/src/payments/frost/frost-cli.ts`
- `packages/sdk/src/payments/frost/frost-signing-coordinator.ts`
- `packages/sdk/src/payments/frost/frost-signer.ts`
- `packages/sdk/src/payments/frost/frost-coordinator.ts`
- `packages/sdk/src/proofs/c2pa-validation.ts`
- `packages/sdk/src/proofs/tlsn-validation.ts`
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts`
- `packages/sdk/src/proofs/verification/checks/tlsn.ts`
- `packages/sdk/src/payments/frost/frost-signing-coordinator.test.ts`
- `packages/sdk/src/proofs/c2pa-validation.test.ts`
- `packages/sdk/src/proofs/tlsn-validation.test.ts`

Verified with:

- `rg -n "new Deno\.Command|Deno\.Command\(" packages/sdk/src --glob '!**/testing/**'`
- `deno test --allow-all packages/sdk/src/payments/frost/frost-signing-coordinator.test.ts packages/sdk/src/proofs/c2pa-validation.test.ts packages/sdk/src/proofs/tlsn-validation.test.ts`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `deno task test:e2e:tlsn` attempted after `docker compose up tlsn-verifier -d`; blocked because the TLSN verifier readiness probe still reported `localhost:7046` / `127.0.0.1:7046` unreachable. No dedicated C2PA e2e task exists.
- `check-silent-bypass` review recorded with `deno run --allow-read --allow-run --allow-write --allow-env scripts/silent-bypass-verify.ts --record`.

Harness update:

- The Deno.Command rg guard confirms only the server execution adapter in `internal/runtime/process.ts` and `internal/runtime/which.ts` uses `Deno.Command`; focused unit tests now cover `frost-cli`, C2PA, and TLSN consuming the injected executor.

Review residuals:

- TLSN e2e should be rerun when local TLSN verifier infrastructure is reachable; required FROST signer e2e passed locally.

Follow-up:

- None
