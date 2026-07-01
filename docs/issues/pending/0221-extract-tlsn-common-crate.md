# Extract a shared crate for duplicated tlsn prover/attestation/codec logic

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0212

Blocks:
- None

## Summary

Core TLSNotary logic is copy-pasted across the crates: `tlsn-prover` contains
three near-identical MPC prover flows (~100 duplicated lines each), the
attestation-signing/verifier logic is duplicated between `tlsn-prover` and
`tlsn-server`, `base64_encode` is byte-for-byte duplicated, and the
`ContentType::ApplicationData` length-summing loop is copied in four places.
A fix (e.g. the 0174 redaction bug or the 0171 key handling) must be applied in
every copy; drift causes divergent behavior between the two halves of the same
protocol.

## Rationale

- `crates/tlsn-prover/src/main.rs`: `run_prover_mpc_futures_stream`
  (~318-429), `run_prover_mpc` (~491-602), `run_prover` (~629-715).
- Attestation duplication: prover `run_verifier` (~775-856) /
  `build_attestation_from_server_data` (~260-291) vs server
  `handle_tcp_attest` (~539-578) / `handle_verifier_ws_raw` (~273-360).
- `base64_encode` at prover ~604 and server ~580.
- A workspace (0212) makes a shared library crate straightforward.

## Acceptance

- A common library crate owns the MPC prover flow, attestation building, and
  shared codecs; the prover/server binaries consume it and the duplicated
  copies are deleted.

## Verification

- Grep confirms one definition of the shared flows/codecs.
- `deno task test:all` Rust gate (clippy + cargo test) passes; crate tests
  from 0183 run against the shared crate.

## Plan

- After 0212, create `crates/tlsn-common` (name per workspace conventions);
  move the shared logic; repoint both binaries.
