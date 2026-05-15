# Complete testnet reference examples

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

feature

## Dependencies

Depends on:
- 0027
- 0028

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

- Resolve 0027 for the C2PA media verification example.
- Resolve 0028 for the TLSN fiat swap example.
- Resolve 0029 for shared example smoke/runbook conventions.
- Update the README status table only after the child issues meet the
  documented completion bar.
