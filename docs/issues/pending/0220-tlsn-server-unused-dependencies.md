# Remove unused heavy dependencies from tlsn-server and gate with an unused-dep check

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

`tlsn-server` declares a large set of dependencies its source never uses:
`axum`, `tower-http`, `reqwest`, `tokio-tungstenite`, `hyper`, `hyper-util`,
`http-body-util` (the code uses `async-tungstenite` directly). `reqwest`/
`hyper`/`axum` each pull large trees — including TLS stacks — into a
security-critical signer for no reason, inflating build time, binary size, and
supply-chain attack surface. They also generate pointless dependabot PRs (an
open `tower-http` bump exists for a dep that should be deleted).

## Rationale

- `crates/tlsn-server/Cargo.toml`: grep shows `axum` appears only in a comment
  (~line 7) and the others zero times in `src/`.
- No unused-dependency check (`cargo machete` / `cargo-udeps`) runs in the
  Rust gate.

## Acceptance

- The unused dependencies are removed from `crates/tlsn-server/Cargo.toml`
  (and any equivalents found in the other three crates).
- An unused-dependency check runs in CI or the local Rust gate so regressions
  are caught.

## Verification

- `cargo build --release --manifest-path crates/tlsn-server/Cargo.toml`
  succeeds without the removed deps.
- The unused-dep check passes on the cleaned tree and fails when an unused
  dep is introduced.

## Plan

- Delete the unused deps; sweep the other crates with `cargo machete`.
- Wire the check into `scripts/test-all.sh`'s Rust gate or CI.
