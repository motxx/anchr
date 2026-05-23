# Absorb payment settlement

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050
- 0051

Blocks:
- 0047

## Summary

Move Cashu payment-lock, redemption, preimage, and release-authority helpers
needed for verifiable paid requests into `@anchr/sdk/payments` or SDK internals.
Delete non-core conditional-swap package surfaces instead of preserving them.

## Rationale

#0046 keeps settlement locks and release authority as SDK payment
responsibilities. Standalone `@anchr/core-cashu`, `@anchr/frost-oracle`, and
`@anchr/cashu-conditional-swap` packages make settlement look like separate
products rather than implementation pieces of verifiable paid requests.

Relevant current surfaces:

- `packages/core-cashu/`
- `packages/frost-oracle/`
- `packages/cashu-conditional-swap/`
- `packages/sdk/`
- `e2e/regtest/`
- `e2e/frost/`

## Acceptance

- Cashu payment-lock and redemption helpers required by the SDK are available
  through `@anchr/sdk/payments` or SDK internals.
- Threshold release authority code remains only if it directly supports the SDK
  paid-request settlement flow.
- Binary-outcome conditional-swap public surfaces are deleted or moved out; no
  `@anchr/cashu-conditional-swap` package remains.
- Package and e2e code no longer imports `@anchr/core-cashu`,
  `@anchr/frost-oracle`, or `@anchr/cashu-conditional-swap`.

## Verification

- No matches are expected:
  `rg -n "@anchr/(core-cashu|frost-oracle|cashu-conditional-swap)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Identify payment and release helpers required by SDK paid-request flows.
- Move retained code and tests into `packages/sdk/src/payments/` or SDK
  internals.
- Delete conditional-swap-only code that is not part of verifiable paid
  requests.
- Rewrite package and e2e imports, then delete absorbed package manifests and
  directories.

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/`
- `packages/bounty/deno.json`
- `packages/bounty/src/`
- `e2e/`
- `deno.json`
- `Dockerfile`
- `scripts/arch-lint.ts`

Verified with:

- `rg -n "@anchr/(core-cashu|frost-oracle|cashu-conditional-swap)" packages e2e deno.json`
- `deno check packages/ e2e/protocol/ e2e/regtest/ e2e/frost/ scripts/arch-lint.ts`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`

Harness update:

- `scripts/arch-lint.ts` now permits the transitional Bounty package to import
  only the SDK payment surface while the retired settlement packages are gone;
  `lint:dockerfile-workspace` also covers the matching Dockerfile workspace
  cleanup.

Review residuals:

- None

Follow-up:

- None
