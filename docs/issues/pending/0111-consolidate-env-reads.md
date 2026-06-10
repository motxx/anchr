# Consolidate direct env reads behind entry-point config

Created: 2026-06-10
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0107

Blocks:
- None

## Summary

15+ modules under `packages/sdk/src` read `Deno.env.get` directly
(`proofs/verification/verifier.ts`, `payments/cashu-wallet.ts`,
`adapters/oracle-service/server.ts` ×6, `attachments/*`,
`adapters/oracle-client/config-loader.ts`, ...). Consolidate reads into
entry-point config resolution (server/CLI startup) and pass values through
existing deps/options, so library modules are env-free.

## Rationale

The `internal/runtime` env port exists but is bypassed. Engine modules that
read env directly cannot be configured per-instance and are hard to test.
Depends on #0107 because the root orchestrators' env/time discipline is
rebuilt there; resolve this issue against the post-unification module set.

## Acceptance

- Library modules under `packages/sdk/src` (excluding server/CLI entry
  points and `internal/runtime`) contain no direct `Deno.env.get` calls.
- Entry points resolve config once and inject it.

## Verification

- Matches only in entry points and `internal/runtime` are expected:
  `rg -n "Deno.env.get" packages/sdk/src`
- `deno task test:all`

## Plan

- Inventory remaining read sites after #0107; route each through the
  nearest existing deps/options object.
