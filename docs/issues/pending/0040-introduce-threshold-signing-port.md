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
