# Complete TLSN fiat swap example

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- 0025

## Summary

Make `example/tlsn-fiat-swap-square/` a reproducible Testnet reference example
for a Customer/Provider flow backed by TLSNotary proof production and
verification.

The example should clearly document the required local services, notary/verifier
assumptions, and commands needed to run the demonstrated flow.

## Rationale

`README.md` marks the TLSN fiat swap example as `Testnet` and describes it as a
Customer/Provider flow with TLSNotary. Because this example touches external
proof tooling, it needs explicit runbook and smoke-test coverage rather than
only compile-time tests.

Relevant files:

- `README.md`
- `example/tlsn-fiat-swap-square/README.md`
- `example/tlsn-fiat-swap-square/`
- `packages/tlsn-toolkit/`
- `e2e/regtest/fiat-swap-square.test.ts`

## Plan

- Audit the example README, config loader, and tests against the current SDK
  and TLSN toolkit APIs.
- Document the required relay, mint, oracle, TLSNotary, and Square sandbox
  fixture assumptions without committing credentials or fund-bearing material.
- Add or update runnable commands for the seller/customer and buyer/provider
  sides.
- Add focused smoke coverage or a `deno task` that exercises the documented
  flow far enough to catch SDK/API drift.
- Update the top-level README status only when the documented flow is
  reproducible.
