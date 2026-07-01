# Add CI dependency caching and dedup redundant Rust builds and lockfile checks

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

CI has no dependency caching anywhere, so every run recompiles all four Rust
crates and the large tlsn/rustls graph from a cold cargo home cache and
`target/`, and re-downloads Deno deps. Within a single run, `frost-signer` is compiled by
both the clippy/test gate and a separate release build, and the frozen-install
lockfile check runs in two workflows. This is the dominant CI cost and makes
every trivial dependency bump slow.

## Rationale

- `.github/workflows/ci.yml`: no `cache`/`rust-cache`/Deno cache anywhere.
- `scripts/test-all.sh` (~lines 77-88, 94-108): Rust gate + separate
  `frost-signer` release build recompile the same crate.
- `ci.yml` (~lines 47-48) and `supply-chain.yml` (~lines 37-64) both run
  `deno install --frozen`.

## Acceptance

- CI caches cargo (cargo home cache + `target/`, keyed on the crate lockfiles +
  `rust-toolchain.toml`) and the Deno dep cache.
- Rust crates are compiled once per run (shared `target/`), not rebuilt per
  phase.
- The frozen-install/lockfile check runs in one place.

## Verification

- A dependency-only PR completes CI materially faster than a cold run
  (cache-hit visible in logs).
- No crate is compiled twice within one CI run.

## Plan

- Add `Swatinem/rust-cache` + Deno cache; consolidate the frozen-install check;
  order the Rust steps to share `target/`.
