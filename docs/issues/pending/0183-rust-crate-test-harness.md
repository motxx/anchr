# Add unit and integration tests to the four Rust crates

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

None of the four sidecar crates (`frost-signer`, `tlsn-prover`, `tlsn-server`,
`tlsn-verifier`) contain a single test function; they are gated only by clippy.
The security-relevant pure functions — BIP-340 x-only lift/drop, redaction
range math, chunked-body decode, `[REDACTED]` rendering, base64 round-trip —
have zero automated coverage, which is exactly where silent regressions hide.

## Rationale

- `grep` for `#[test]` / `#[tokio::test]` / `mod tests` across `crates/`
  returns nothing; no `tests/` directories exist.
- This harness is the prerequisite for verifying 0171, 0173, 0174, 0176.

## Acceptance

- Each crate has unit tests for its pure functions (redaction ranges,
  `subtract_ranges`, chunked decode, redaction rendering, base64 round-trip,
  BIP-340 encode/verify round-trip).
- At least one integration test drives a full prove → verify cycle.
- Tests run under the existing `test:all` Rust gate.

## Verification

- `cargo test` per crate reports a non-zero passing test count.
- `deno task test:all` runs the crate tests in the Rust gate.

## Plan

- Extract pure functions where needed for testability; add `#[cfg(test)]`
  modules.
- Add a prove→verify integration test (feature-gated on infra where required).
