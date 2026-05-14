# Complete testnet reference examples

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

feature

## Dependencies

Depends on:
- 0024

Blocks:
- None

## Summary

Make the README-listed Testnet examples reproducible end to end, with clear
setup, environment, local stack, and smoke-test commands:

- `example/c2pa-media-verification/`
- `example/tlsn-fiat-swap-square/`

These examples should match the README promise that they demonstrate complete
Customer/Provider flows.

## Rationale

`README.md` points the Quick Start reader to
`example/c2pa-media-verification/` for "a complete running flow" and marks both
the C2PA photo marketplace and TLSN fiat swap examples as `Testnet`.

The examples need a maintained completion bar so they do not drift into
compile-only demos:

- documented required services: relay, mint, oracle, notary where applicable;
- checked env var templates;
- one command or short command sequence to run the flow;
- automated smoke coverage that fails when the example stops matching the SDK
  API.

## Plan

- Audit the two Testnet example READMEs against the current SDK API and local
  stack commands.
- Add or update `.env.example` / config documentation for every required
  variable, without committing secrets or fund-bearing material.
- Add runnable commands for customer, provider, and oracle/notary components as
  applicable.
- Add focused smoke tests or `deno task` entries that exercise the documented
  happy path.
- Update the README status table only after the examples meet the documented
  completion bar.
