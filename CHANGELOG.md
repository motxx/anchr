# Changelog

All notable changes to this project will be documented here.

The project is pre-1.0 and experimental. Breaking changes may happen between
minor versions until the SDK API is declared stable.

## Unreleased

- Pinned TLSNotary presentations to a configured persistent notary key so an
  untrusted prover cannot substitute its own self-consistent signing key.
- Moved the in-process Paid Request test into the integration tier so the unit
  and integration tasks classify it consistently.
- Removed unused SDK surface (pre-1.0 cleanup, issues 0228/0230): the `Query`
  fields `challenge_rule`, `published_proofs`, and `visibility` (with the
  `ProofVisibility` type), the unreachable `"submitted"` status,
  `isCancellable` (use `isOpenStatus`), the `ProofDelivery` port, the
  oracle-registry singleton helpers `getOracle` / `listOracles` /
  `registerOracle` / `resolveOracle` (construct a registry with
  `createOracleRegistry` instead), and the unused `QueryRepository` /
  `queryTemplates` modules.
- Added package dry-run and SDK npm build checks to CI.
- Fixed package publish configuration for the SDK.
