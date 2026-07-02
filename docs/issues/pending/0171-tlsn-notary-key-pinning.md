# Persist the TLSN notary key and pin it in the verifier

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
