# Complete testnet reference examples

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

feature

## Dependencies

Depends on:
- None

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

- Update the README status table only after the child issues meet the
  documented completion bar.

## Resolution

Implemented by updating:

- `docs/issues/closed/0027-complete-c2pa-media-example.md`
- `docs/issues/closed/0028-complete-tlsn-fiat-swap-example.md`

Verified with:

- `deno task --config example/c2pa-media-verification/deno.json smoke`
- `deno task --config example/tlsn-fiat-swap-square/deno.json smoke`
- `deno task test:examples`
- `deno task lint:strict`

Harness update:

- None — this aggregate issue is closed by the child smoke harness updates in
  0027 and 0028; the top-level README already marked both examples as
  `Testnet`.

Review residuals:

- None

Follow-up:

- None
