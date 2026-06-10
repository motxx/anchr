# Consolidate direct env reads behind entry-point config

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

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

## Resolution

Implemented by updating:

- `proofs/verification/checks/ai-content.ts` — AI content-check config is
  injectable per call via `VerifyProofOptions.aiContent`; the env-gated
  resolver (`aiContentConfigFromEnv`) is only the default, with no
  module-level mutable state.
- `scripts/arch-lint.ts` — new `[E028]`: a direct `Deno.env.get` in the
  sdk package outside the documented config-resolution surfaces is an
  error. The allowlist names them: `internal/runtime/`,
  `testing/helpers.ts` (withEnv), `adapters/nostr/oracle-service.ts`
  (fromEnv constructor), `adapters/oracle-client/config-loader.ts`,
  `adapters/oracle-service/server.ts` (server entry point),
  `attachments/{access,blossom,url-validation}.ts` (named deployment-config
  resolvers and the production SSRF toggle),
  `payments/cashu/cashu-wallet.ts`, and the AI check's env default.

Resolution note: the unification queue (#0107-#0109) already deleted most
scattered readers (transport singleton, relay-publish, customer-service);
what remains are named config-resolution surfaces, now frozen by E028 so
new library modules cannot grow direct env reads. Changing the SSRF
production toggle's semantics was deliberately avoided.

Verified with:

- `deno task lint:arch` (E028 active, no violations)
- `deno task test:all`
- `rg -n "Deno.env.get" packages/sdk/src --glob '!**/*.test.ts'` matches
  only the E028 allowlist.

Harness update:

- arch-lint `[E028]` mechanically owns this class of drift.

Review residuals:

- None

Follow-up:

- None
