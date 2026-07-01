# Introduce a Cargo workspace with a shared lockfile

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The four crates have no top-level workspace and each keeps its own `Cargo.lock`,
so versions resolve independently and shared crypto deps (`tlsn`, `k256`,
`tokio`) can drift across the two halves of the same protocol. There is no
single place to audit or update deps, and each shared-dependency bump fans out
into 3-4 dependabot PRs (the backlog in 0211). Feature drift already exists
(e.g. `async-tungstenite` feature sets differ between prover and server).

## Rationale

- No root `Cargo.toml` workspace; four separate `Cargo.lock` files.
- `crates/tlsn-prover/Cargo.toml` (~line 30) vs `tlsn-server/Cargo.toml`
  (~line 28): divergent `async-tungstenite` features; server mixes tungstenite
  0.26 / async-tungstenite 0.29.
- Manifests pin only major versions (`tokio="1"`, `clap="4"`, `serde="1"`);
  only the unshared lockfiles pin exact versions.

## Acceptance

- A Cargo workspace with a single shared lockfile and
  `[workspace.dependencies]` holds the shared/pinned deps (including the
  `tlsn`/`spansy` git pins); crate manifests inherit from it.

## Verification

- One `Cargo.lock` at the workspace root; `cargo metadata` shows one resolved
  version per shared dep.
- `deno task test:all` (Rust gate) passes.

## Plan

- Add the workspace manifest; move shared deps to `[workspace.dependencies]`;
  delete per-crate lockfiles.
