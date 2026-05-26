# Introduce threshold signing port

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-20

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

## Resolution

Implemented by updating:

- `packages/cashu-conditional-swap/src/frost-dual-key-store.ts`
- `packages/cashu-conditional-swap/src/frost-dual-key-store.test.ts`
- `example/two-party-binary-bet/src/market-api-routes.ts`
- `example/two-party-binary-bet/src/server-routes.ts`
- `example/two-party-binary-bet/src/market-settlement.ts`
- `packages/cashu-conditional-swap/README.md`
- `specs/conditional-swap.md`

Changed the binary-bet FROST path from a synchronous `DualKeyStore`
implementation into an async `BinaryOutcomeReleaseAuthority`. Local single-key
demo signing remains available through `createSingleKeyReleaseAuthority`, while
distributed FROST signing uses `createFrostReleaseAuthority` and delegates to
`coordinateSigning()` without exposing synchronous placeholder signing.

Verified with:

- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/cashu-conditional-swap/src/frost-dual-key-store.test.ts packages/cashu-conditional-swap/src/frost-conditional-swap.test.ts`
- `deno test --allow-all example/two-party-binary-bet/src/server-routes.test.ts example/two-party-binary-bet/src/auto-resolver.test.ts example/two-party-binary-bet/src/market-api-routes.test.ts example/two-party-binary-bet/src/market-signer-endpoints.test.ts example/two-party-binary-bet/src/resolution.test.ts example/two-party-binary-bet/src/resolution-flow.test.ts`
- `deno task lint:strict`
- `deno task test:unit`

Harness update:

- Added `packages/cashu-conditional-swap/src/frost-dual-key-store.test.ts`
  coverage for the async release-authority lifecycle, explicit single-key mode,
  FROST group-pubkey exposure without synchronous signing, and empty
  proof-secret signing rejection.
- Updated `specs/conditional-swap.md` to record the async release-authority
  boundary and the rule that FROST implementations must not hide threshold
  failure behind synchronous success-shaped APIs.

Silent-bypass review:

- Reviewed the changed signing/settlement files. `releaseSignature()` and
  `releaseProofSecretSignatures()` return `null` for unknown swaps, double
  release, empty proof-secret requests, and threshold failures; they only mark a
  swap signed after a concrete signature result is returned.

Review residuals:

- `packages/bounty/src/application/ports.ts` still has the query-specific
  `FrostSignaturePort`; reconciling that with the package-wide release
  authority taxonomy belongs with #0041.
- Final package placement for the release-authority implementation belongs with
  #0043.

Follow-up:

- #0041
- #0043
