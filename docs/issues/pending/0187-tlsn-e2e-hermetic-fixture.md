# Make the TLSN e2e hermetic instead of depending on a live exchange API

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

The TLSN e2e presentation generation and the INV-01 flow target a live
third-party production API (`api.bitflyer.com`). Downtime, rate limiting, or a
response-shape change fails the anti-forgery suite for reasons unrelated to
Anchr, making a security-critical suite flaky and non-hermetic.

## Rationale

- `e2e/tlsn/tlsn.test.ts` (~line 43) and `e2e/tlsn/tlsn-browser.test.ts`
  (~line 162) both request
  `https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY`.

## Acceptance

- The tlsn compose profile serves a controlled fixture the prover targets; the
  anti-forgery suite no longer depends on an external exchange.
- Any remaining live-target test is explicitly opt-in (not part of the default
  gate).

## Verification

- `deno task test:e2e:tlsn` passes with external network to the exchange
  blocked.

## Plan

- Add a fixture server to the tlsn compose profile and point the prover at it.
- Gate any live-target smoke test behind an opt-in env flag.
