# Persist the TLSN notary key and pin it in the verifier

Created: 2026-07-02
Completed: 2026-08-30
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The TLSNotary sidecars sign every attestation with an ephemeral key generated
per invocation, and the verifier trusts any key. This removes the trust anchor:
a caller who runs their own prover/server can produce a self-consistent
"valid" presentation, so an attestation proves nothing about provenance. In a
system where verified proofs gate a payment release, this defeats the whole
TLSN path.

## Rationale

- `crates/tlsn-prover/src/main.rs` (attestation signing, ~lines 272 and 824)
  and `crates/tlsn-server/src/main.rs` (~line 558) each sign with
  `SigningKey::random(&mut rand::thread_rng())`; the key is never loaded from
  a persistent source or published.
- `crates/tlsn-verifier/src/main.rs` (~lines 55, 63) verifies with
  `CryptoProvider::default()` and never checks the attestation's notary
  verifying key against a trusted/pinned value.
- Relates to threat-model INV-01 (TLSN anti-forgery) — see 0184.

## Acceptance

- The notary signing keypair is loaded from a configured, persistent source
  (file/KMS/env), not regenerated per run, and its public key is discoverable.
- `tlsn-verifier` rejects any presentation whose notary verifying key does not
  match a configured, pinned notary key.

## Verification

- Unit/integration test: a presentation signed by a non-pinned key is rejected
  with a distinct error; one signed by the pinned key is accepted.
- Manual: two consecutive prover runs produce attestations verifiable against
  the same published notary key.

## Plan

- Add notary key configuration (load + persist) to prover/server.
- Add a pinned-key check to the verifier and thread the trusted key through
  its config.
- Cover with a Rust test once 0183 lands the crate test harness.

## Resolution

Implemented by updating:

- `crates/tlsn-prover/src/main.rs` and `crates/tlsn-server/src/main.rs` to load
  one configured secp256k1 signing key and publish its compressed public key at
  startup.
- `crates/tlsn-verifier/src/main.rs` to require and compare a configured public
  key before cryptographic presentation verification.
- `packages/sdk/src/proofs/tlsn-validation.ts` and the TLSN schema check to
  require the pin and pass it to the verifier sidecar.
- `docker-compose.yml` and `README.md` with local-E2E and deployment
  configuration.
- `docs/threat-model.md` and its lock to include the configured notary in
  INV-01.

Verified with:

- `deno task check` — pass
- focused SDK TLSN tests — 25 steps passed
- `cargo clippy --locked --all-targets --all-features` and `cargo test
  --locked` for all three TLSN crates — pass
- `deno task test:all` — pass
- `deno task test:all:docker` — pass, including TLSNotary E2E (7 steps)
- `check-silent-bypass` — no findings in the two changed package source files
- `security-max-audit` — no critical or warning findings

Harness update:

- Added Rust unit coverage for accepted and non-pinned notary keys.
- Added SDK coverage for missing pin rejection and sidecar pin propagation.
- Added an INV-01 Docker E2E check for a valid presentation verified against a
  different configured notary key.

Review residuals:

- Production key custody and rotation remain deployment responsibilities; the
  code accepts an environment-provided key as allowed by this issue.

Follow-up:

- Existing issue 0187 tracks replacing the live exchange dependency in the
  TLSNotary E2E with a hermetic fixture.
