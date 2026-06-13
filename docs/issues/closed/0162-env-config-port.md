# Inject an env-config port instead of direct Deno.env reads

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

Child of 0149 (env-config port). The SDK reads configuration directly through
`Deno.env.get` at many call sites, which has no browser equivalent and blocks
the portable surface. Put environment configuration behind an injectable port
with a server adapter (reads `Deno.env`, current behavior) so that browser hosts
can supply config by construction instead of relying on a global env.

Current direct `Deno.env` reads (non-test, after Phase A/B deletions):

- `packages/sdk/src/internal/runtime/config.ts` (the central reader)
- `packages/sdk/src/attachments/access.ts`, `attachments/url-validation.ts`,
  `attachments/blossom.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/internal/runtime/logger.ts`
- `packages/sdk/src/payments/cashu/cashu-wallet.ts`

(`internal/runtime/runtime.ts` feature-detects `Deno`; that probe is allowed.
`testing/helpers.ts` and server entrypoints may keep direct env access.)

## Rationale

- Premise: the SDK must run in browser and server. `Deno.env` is the most
  pervasive of the three runtime channels and must be constructor-injected so a
  browser host can supply configuration.
- The server adapter preserves current behavior (reads `Deno.env`); a browser
  adapter takes caller-supplied config.

## Acceptance

- A config port exists with a server adapter that reads `Deno.env`; feature
  modules receive configuration through injection rather than calling
  `Deno.env.get` directly.
- No direct `Deno.env.get/set/delete` remains in the listed feature modules
  (outside `internal/runtime/` server adapters, server entrypoints, and
  `testing/`).

## Verification

- No matches are expected outside the env adapter, server entrypoints, and
  testing helpers:
  `rg "Deno\.env\.(get|set|delete)" packages/sdk/src --glob '!**/testing/**'`
  (remaining matches must be the env adapter in `internal/runtime/` and the
  server entrypoint module(s)).
- `deno task check`, `deno task lint:strict`, `deno task test:all` pass.

## Plan

- Define the config port + server adapter; thread injected config into the
  feature modules listed above.
- Keep the server adapter as the default so server behavior is unchanged.

## Resolution

Implemented by updating:

- `packages/sdk/src/internal/runtime/config.ts`
- `packages/sdk/src/internal/runtime/config.test.ts`
- `packages/sdk/src/internal/runtime/logger.ts`
- `packages/sdk/src/attachments/access.ts`
- `packages/sdk/src/attachments/blossom.ts`
- `packages/sdk/src/attachments/blossom.test.ts`
- `packages/sdk/src/attachments/fetch-attachment.ts`
- `packages/sdk/src/attachments/provider-upload.ts`
- `packages/sdk/src/attachments/upload.ts`
- `packages/sdk/src/attachments/upload.test.ts`
- `packages/sdk/src/attachments/url-validation.ts`
- `packages/sdk/src/attachments/url-validation.test.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.integration.test.ts`
- `packages/sdk/src/payments/cashu/cashu-wallet.ts`
- `packages/sdk/src/payments/cashu/cashu-escrow-helpers.ts`
- `packages/sdk/src/payments/cashu/wallet-store.ts`
- `packages/sdk/src/payments/cashu/wallet-store-helpers.ts`
- `scripts/arch-lint.ts`

Verified with:

- `rg -n "Deno\.env\.(get|set|delete)" packages/sdk/src --glob '!**/testing/**'`
- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:integration`

Harness update:

- The E028 ENV_READ arch-lint rule and its shrunk `ENV_READ_ALLOWED` list now
  enforce that only the config adapter, testing helper, and server entrypoint
  read env directly.

Review residuals:

- None

Follow-up:

- None
