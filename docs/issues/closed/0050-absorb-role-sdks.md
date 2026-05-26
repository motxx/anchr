# Absorb role SDKs

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

maintenance

## Dependencies

Depends on:
- 0046

Blocks:
- 0047

## Summary

Move the current Customer, Provider, and Oracle SDK surfaces into
`packages/sdk/src/` so application developers use `@anchr/sdk` instead of
three role-specific public packages.

## Rationale

Parent issue #0047 collapses public packages to `@anchr/sdk` and
`@anchr/protocol`. The role SDKs are the highest-level developer-facing pieces
and should become SDK role modules before lower-level adapters and lifecycle
code are absorbed.

Relevant current surfaces:

- `packages/customer-sdk/`
- `packages/provider-sdk/`
- `packages/oracle-sdk/`
- `packages/sdk/`
- `e2e/regtest/sdk-integration.test.ts`
- `e2e/regtest/fiat-swap-square.test.ts`

## Acceptance

- Customer, Provider, and Oracle public APIs are exported from `@anchr/sdk` or
  approved `@anchr/sdk/{customer,provider,oracle}` subpaths.
- Package and e2e code no longer imports `@anchr/customer-sdk`,
  `@anchr/provider-sdk`, or `@anchr/oracle-sdk`.
- The standalone role SDK package manifests are deleted when their exports are
  absorbed.
- Role SDK tests are moved with the implementation or replaced by SDK tests
  covering the same behavior.

## Verification

- No matches are expected:
  `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Compare role SDK exports with the `@anchr/sdk` public subpaths approved in
  #0046.
- Move role orchestration, types, and focused tests into `packages/sdk/src/`.
- Rewrite package and e2e imports to use `@anchr/sdk` role exports.
- Delete absorbed role SDK manifests and directories once no references remain.

## Resolution

Implemented by updating:

- `packages/sdk/src/customer.ts`
- `packages/sdk/src/customer-types.ts`
- `packages/sdk/src/provider.ts`
- `packages/sdk/src/provider-types.ts`
- `packages/sdk/src/oracle.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/deno.json`
- `packages/sdk/package.json`
- `packages/sdk/tsconfig.json`
- `packages/sdk/scripts/build-bundle.ts`
- `packages/sdk/scripts/fix-dts-imports.ts`
- `deno.json`
- `Dockerfile`
- `e2e/regtest/sdk-integration.test.ts`

Verified with:

- `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk)" packages e2e deno.json`
- `deno test packages/sdk/src --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno check e2e/regtest/sdk-integration.test.ts`
- `deno task lint:strict`

Harness update:

- Moved the Customer, Provider, Oracle, and in-process wiring tests into
  `packages/sdk/src/` so the absorbed SDK role modules retain focused coverage.

Review residuals:

- None

Follow-up:

- None
