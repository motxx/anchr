# Add a Rust compile/clippy/test gate and pin the toolchain

Created: 2026-06-11
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The `crates/*` Rust binaries (FROST release authority, TLSNotary
prover/verifier/server) have no `cargo clippy` or `cargo test` gate, and
`crates/tlsn-server` is first compiled at deploy time. The toolchain floats on
`stable`. A compile- or lint-breaking change to the cryptographic core passes CI
and only fails at deploy.

## Rationale

From `docs/production-readiness-audit.md` §2.3 (ARCH-01, folds OPS-08):

- `scripts/test-all.sh:82,188,193` only `cargo build`s `frost-signer`,
  `tlsn-prover`, `tlsn-verifier`. No `cargo clippy` and no `cargo test` exist
  anywhere.
- `crates/tlsn-server` is first compiled by `flyctl deploy`
  (`.github/workflows/deploy.yml:43-62`), after CI.
- `.github/workflows/ci.yml:50-51` uses the floating
  `dtolnay/rust-toolchain@stable`; there is no `rust-toolchain.toml`.

## Acceptance

- A pinned `rust-toolchain.toml` exists at the repo root.
- `cargo clippy --all-targets -- -D warnings`, a `cargo check`/build for
  `tlsn-server`, and `cargo test --all` run in `scripts/test-all.sh` and
  `.github/workflows/ci.yml` over all four crates.
- The Rust gate is referenced in the verification bar.

## Verification

- `deno task test:all` builds, clippies, and tests all four crates including
  `tlsn-server`.
- `cargo clippy --manifest-path crates/tlsn-server/Cargo.toml -- -D warnings`
  passes.
- `cat rust-toolchain.toml` shows a pinned channel.

## Plan

- Add `rust-toolchain.toml` with a pinned channel.
- Wire clippy/check/test steps into `scripts/test-all.sh run_local` and
  `ci.yml`; consider a root Cargo workspace to run them in one pass.
- The `crates/` documentation in `docs/architecture.md`/`CLAUDE.md` is owned by
  the architecture-conformance issue (ARCH-02), not this one — cross-reference,
  do not duplicate.

## Resolution

Implemented by updating:

- `rust-toolchain.toml` (new, repo root) — pins `channel = "1.94.0"` with
  the clippy component
- `scripts/test-all.sh` — `run_rust_gate()` runs
  `cargo clippy --all-targets -- -D warnings` and `cargo test` for all four
  crates (`frost-signer`, `tlsn-prover`, `tlsn-verifier`, `tlsn-server`) in
  the local/CI orchestration; `tlsn-server` is now compiled and linted
  before deploy time
- `.github/workflows/ci.yml` — `dtolnay/rust-toolchain@1.94.0` (kept in sync
  with `rust-toolchain.toml` by comment)
- `CLAUDE.md` — verification bar lists the Rust gate
- clippy fixes across `crates/frost-signer`, `crates/tlsn-prover` (dead MPC
  stream path deleted), `crates/tlsn-server` (dead `--webhook-url` flag and
  unused session fields deleted)

Verified with:

- `cargo clippy --all-targets -- -D warnings` per crate (×4 pass)
- `cargo test` per crate (×4 pass)
- `deno task test:all` (includes the gate)

Harness update:

- The Rust gate in `scripts/test-all.sh` / `ci.yml` is the harness update —
  compile/lint/test breakage in the crates now fails CI instead of deploy.

Review residuals:

- No root Cargo workspace: the tlsn-server Dockerfile copies its own
  manifest/lockfile; a workspace would break that deploy path.

Follow-up:

- None
