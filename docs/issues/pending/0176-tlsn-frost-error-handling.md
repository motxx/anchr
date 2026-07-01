# Replace panics and silent failures in tlsn/frost request paths

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Several Rust request-handling paths panic on untrusted input or swallow errors
instead of surfacing them, turning recoverable failures into crashes, hangs,
or silently-wrong output. These are correctness/robustness defects on
security-critical sidecars.

## Rationale

- `crates/tlsn-prover/src/main.rs`: `.expect(...)` on `server_cert_chain()` /
  `server_signature()` (~lines 416-417, 589-590, 745-751) panics on an
  incomplete handshake; hand-rolled base64 decode maps invalid chars to `0`
  silently (~lines 293-314), corrupting network-received material.
- `crates/tlsn-server/src/main.rs`: `bincode::serialize(...).unwrap_or_default()`
  sends empty `connectionInfo` on failure (~line 265); `/session` returns
  without responding on parse/register errors (~lines 161-168); MPC errors are
  logged to stderr only and never reported to the waiting session (~356-358).
- `crates/frost-signer/src/main.rs`: `verify()` maps every error to
  `{"valid": false}` (~lines 356-358), conflating malformed input with a
  cryptographically invalid signature; `unwrap()` in the output printer
  (~lines 107, 113); `tlsn-verifier` output `unwrap()` (~line 29).

## Acceptance

- Untrusted-input failures return handled errors rather than panicking.
- Request handlers propagate real errors (explicit WS/response error frames)
  instead of empty defaults or silent returns.
- `frost-signer verify()` distinguishes "malformed input" from "invalid
  signature".

## Verification

- Rust tests: malformed handshake input yields an error not a panic; a
  malformed signature and an invalid-but-well-formed signature yield distinct
  results (added under 0183 harness).

## Plan

- Replace `expect`/`unwrap` on untrusted fields with `?`/`ok_or_else`.
- Use the `base64` crate with strict decoding.
- Emit explicit error frames/responses; split malformed vs invalid in verify.
