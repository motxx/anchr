# Close fast-tier unit-coverage gaps for money, settlement, and auth modules

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Several security- and fund-critical modules have only export-shape or indirect
Docker-only coverage, giving the default local test run false confidence. This
issue closes the concrete fast-tier (unit) gaps. The resolver should re-read the
listed modules and add same-file `*.test.ts` coverage for their behavior and
error branches.

## Rationale

- `packages/sdk/src/payments/cashu/cashu-escrow.ts` (~line 432)
  `calculateOracleFee` — money math with no behavioral test (rounding, zero
  fee, large amounts).
- `packages/sdk/src/adapters/oracle-service/auth.ts` (~line 12) `safeCompare` —
  wrong-token and wrong-length branches untested (`server-frost.test.ts` covers
  only missing/valid token).
- `packages/sdk/src/payments/cashu/redeem-swap.ts`,
  `cashu-escrow.ts` swap primitives — exercised only via Docker `e2e/regtest`.
- `packages/sdk/src/adapters/oracle-service/frost-*-routes.ts`,
  `server-entry.ts` — route error inputs and config bootstrap untested.
- `packages/sdk/src/proofs/verification/checks/photo-integrity.ts`
  `parseC2paImageSchemaOptions` — option-parsing branches untested (INV-06).
- Test-shape context (2026-07-02 architecture review): the repo has 71 unit
  test files, 1 integration test file, and 19 e2e files (~7.6k lines);
  `customer.test.ts` (1,688 lines) and `provider.test.ts` (1,069) compensate
  for missing facade seams (see 0191). The near-empty middle tier is why these
  gaps default to Docker-only coverage.

## Acceptance

- Each listed module has same-file unit tests covering its behavioral and
  error/edge branches (no I/O), discovered by `deno task test:unit`.

## Verification

- `deno task test:unit` runs the new tests; each listed file has a sibling
  `*.test.ts` exercising non-happy-path branches.

## Plan

- Add table-driven tests for `calculateOracleFee` and `safeCompare`.
- Add stubbed-mint tests for swap-failure / partial-proof branches.
- Add route error-input and `server-entry` config tests, and direct
  `parseC2paImageSchemaOptions` tests.
