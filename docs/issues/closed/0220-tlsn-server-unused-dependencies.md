# Remove unused heavy dependencies from tlsn-server and gate with an unused-dep check

Created: 2026-07-02
Model: Claude Fable 5
Completed: 2026-07-02

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

## Resolution

Implemented by updating:

- `crates/tlsn-server/Cargo.toml` — removed `axum`, `tower-http`, `reqwest`,
  `hyper`, `hyper-util`, `http-body-util`, `tokio-tungstenite`, plus two more
  the sweep found: `tungstenite` (all uses go through the
  `async_tungstenite::tungstenite` re-export) and `serde` (only `serde_json`
  is used). The lockfile shed ~1,200 lines, including the whole
  `reqwest`→`quinn` tree that carried RUSTSEC-2026-0185.
- `crates/tlsn-prover/Cargo.toml` — removed `serde`, `spansy`,
  `tlsn-formats` (sweep findings).
- `crates/tlsn-verifier/Cargo.toml` — removed `serde`, `hex`, `tlsn-core`
  (sweep findings).
- `crates/frost-signer/Cargo.toml` — removed `serde` (sweep finding).
- `scripts/test-all.sh` — the Rust crate gate now runs
  `cargo machete` over all four crates before clippy/test, failing with an
  install hint when the tool is missing.
- `.github/workflows/ci.yml` — the pinned `taiki-e/install-action` step now
  installs `cargo-machete` alongside `cargo-audit`.

Every machete finding was manually confirmed against `src/` before removal
(`serde` derive usage, re-export paths) — zero false positives.

Verified with:

- `cargo machete crates/frost-signer crates/tlsn-prover crates/tlsn-server
  crates/tlsn-verifier` — exit 0 on the cleaned tree.
- Negative check: re-adding `hex = "0.4"` to `tlsn-verifier` makes
  `cargo machete` exit 1 naming the dep, so the gate fails as required.
- `cargo clippy --all-targets -- -D warnings` and
  `cargo build --release` — clean for all four crates.
- `deno task lint:deps` — cargo audit passes (140 deps, down from 233 in
  tlsn-server).
- `deno task test:all` — full local bar.

Harness update:

- The `cargo machete` step in `scripts/test-all.sh`'s Rust gate (mirrored in
  CI via `taiki-e/install-action`) now absorbs this class of finding.

Review residuals:

- None

Follow-up:

- Dependabot PRs #181 (tower-http) and #165 (hyper in tlsn-server) are mooted
  by the removals and should be closed during the 0211 backlog triage.
