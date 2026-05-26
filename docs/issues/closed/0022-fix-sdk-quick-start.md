# Fix SDK Quick Start

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Update the root `README.md` Quick Start and `packages/sdk/README.md` Customer example so they match the current `@anchr/sdk` API and do not present code that fails immediately.

## Rationale

The current root Quick Start calls `createCustomer` with `oracles`, `relays`, `mint`, and `oracleClient`, but the current `CustomerOptions` type in `packages/customer-sdk/src/types.ts` also requires `cashuClient` and `relayClient`.

Running the root Quick Start shape against the current workspace throws `CustomerConfigError: cashuClient adapter is required`. Adding only `createCashuClient` still throws `CustomerConfigError: relayClient adapter is required`. `packages/sdk/README.md` already includes `createCashuClient`, but it also omits `relayClient`.

The docs should either provide a compile-checkable minimal snippet that imports and passes `createCashuClient` and `createRelayClient`, or explicitly mark omitted adapter wiring with a non-runnable placeholder. Prefer the compile-checkable path so README drift is easier to catch.

## Plan

- Update root `README.md` Quick Start imports and `createCustomer` options to include `createCashuClient` and `createRelayClient`.
- Update `packages/sdk/README.md` Customer example the same way.
- Use placeholder values that do not look like real secrets or fund-bearing data.
- Verify the snippets' construction shape against the current SDK, at minimum with `deno check` or a focused docs snippet check if one exists.

## Resolution

Implemented by updating:

- `README.md`
- `packages/sdk/README.md`
- `scripts/readme-snippets.test.ts`

Verified with:

- `deno check --doc-only README.md packages/sdk/README.md`
- `deno test --allow-run scripts/readme-snippets.test.ts`
- `deno task test:scripts`
- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- Added `scripts/readme-snippets.test.ts` so `deno task test:scripts` type-checks the TypeScript snippets in the root and SDK READMEs.

Review residuals:

- None

Follow-up:

- None
