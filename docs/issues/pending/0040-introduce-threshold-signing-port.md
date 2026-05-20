# Introduce threshold signing port

Created: 2026-05-20
Model: GPT-5

## Priority

design

## Dependencies

Depends on:
- 0037

Blocks:
- 0041
- 0043

## Summary

Define an async threshold-signing/release-authority port for FROST-backed
settlement and stop forcing distributed FROST signing through synchronous key
store interfaces.

## Rationale

Relevant references:

- `docs/architecture.md` target directory taxonomy and release-authority row
- `docs/issues/closed/0037-document-target-boundary-taxonomy.md`
- `packages/frost-oracle/src/signing-coordinator.ts`
- `packages/frost-oracle/src/frost-cli.ts`
- `packages/cashu-conditional-swap/src/frost-dual-key-store.ts`
- `packages/cashu-conditional-swap/src/frost-conditional-swap.ts`
- `packages/bounty/src/application/ports.ts`
- `packages/bounty/src/infrastructure/oracle-service/frost-signer-routes.ts`

`DualKeyStore.sign()` is synchronous, but real FROST signing is inherently
asynchronous because it coordinates nonce commitments and signature shares
across peer signer nodes. The current FROST-backed dual key store returns
`null` from synchronous signing methods and asks consumers to call separate
async helpers. That is a boundary mismatch.

The better boundary is an explicit async signing authority or release authority
port, with local single-key signing as a separate implementation where needed.

Important implementation facts to preserve:

- FROST/DKG is already a real cryptographic path, not a mock-only surface:
  `crates/frost-signer` runs the DKG and signing operations,
  `packages/frost-oracle/src/frost-cli.ts` wraps that binary, and
  `e2e/frost/frost-threshold.test.ts` covers DKG, threshold signing,
  below-threshold failure, and signature verification.
- `packages/bounty/src/infrastructure/oracle-service/frost-signer-routes.ts`
  is a peer Oracle verify-and-sign endpoint. It should remain a path where each
  signer independently verifies evidence before producing nonce commitments or
  signature shares.
- `packages/bounty/src/infrastructure/oracle-service/frost-dkg-routes.ts` is
  DKG session/package coordination, not the cryptographic DKG implementation
  itself. The actual round operations happen in signer-side FROST code.
- Do not collapse FROST threshold signing into the simple `oracle-sdk` HTTP hash
  client. The architecture treats `frost-oracle` as a threshold
  release-authority component, not as the actor-level Oracle SDK.
- The new boundary should account for both release forms described by the
  architecture: single-Oracle preimage release and FROST threshold signatures.
  It should separate the abstract release decision/signing request from concrete
  transports such as HTTP routes, Nostr DMs, or local demo stores.

## Plan

- Define the canonical async signing/release port shape for binary outcomes and
  query settlement.
- Decide whether the existing `FrostSignaturePort` is the right home or whether
  a settlement-level port should replace it.
- Refactor FROST consumers to call the async port directly instead of treating
  FROST as a synchronous `DualKeyStore`.
- Keep local single-key demo stores separate from distributed threshold signing
  implementations.
- Update FROST tests and examples to prove threshold signing and fallback paths
  remain explicit.
