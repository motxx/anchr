# Complete C2PA media example

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

feature

## Dependencies

Depends on:
- 0024
- 0029

Blocks:
- 0025

## Summary

Make `example/c2pa-media-verification/` a reproducible Testnet reference
example for a Customer/Provider flow with photo or media verification.

The example should have enough setup, configuration, and smoke coverage that a
reader can run the documented flow without relying on stale SDK assumptions.

## Rationale

`README.md` points Quick Start readers to
`example/c2pa-media-verification/` as the complete running flow, and the
Reference Implementations table marks it as `Testnet`.

Relevant files:

- `README.md`
- `example/c2pa-media-verification/README.md`
- `example/c2pa-media-verification/`
- `packages/customer-sdk/`
- `packages/provider-sdk/`

## Plan

- Audit the example README and scripts against the current Customer/Provider
  SDK API.
- Add or update non-secret env/config examples for relay, mint, oracle, and any
  C2PA media fixtures.
- Document the exact commands to run the provider and requester sides locally.
- Add focused smoke coverage or a `deno task` that exercises the documented
  happy path far enough to catch SDK/API drift.
- Update the top-level README status only when the example is actually
  reproducible by the documented commands.
