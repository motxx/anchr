# Delete HTTP Oracle exchange surface

Created: 2026-06-13
Model: GPT-5.4-Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

The v0 Customer/Provider/Oracle exchange is relay-based through the Nostr
adapter. The HTTP exchange surface in `packages/sdk/src/adapters/oracle-service/`
and `packages/sdk/src/adapters/oracle-client/` should no longer own preimage
issuance or verification delegation for that exchange.

Delete the package-owned HTTP exchange pieces: the HTLC `/hash`, `/hash/:queryId`,
and `/verify` routes, the HTTP Oracle client, HTTP config loader, and public
exports that make the Customer/Provider/Oracle exchange depend on a hosted
Oracle HTTP endpoint. After this closes, the relay Oracle service is the single
SDK owner for preimage or release-material issuance in the v0 exchange.

FROST Oracle-to-Oracle coordination is a distinct surface and stays in the SDK
as a reduced FROST-only peer endpoint module. That module owns the current
round-1/round-2 signer endpoints, DKG endpoints, and coordinator-side signing
routes needed by `test:e2e:frost`; issue 0153 owns making the peer round-1 and
round-2 transport injectable.

## Rationale

- `packages/sdk/src/adapters/nostr/oracle-service.ts` is the canonical relay
  Oracle daemon for the Customer/Provider/Oracle exchange.
- `packages/sdk/src/adapters/oracle-service/htlc-routes.ts` duplicates
  preimage issuance and proof verification through HTTP routes.
- `packages/sdk/src/adapters/oracle-client/http-oracle.ts` and
  `config-loader.ts` make remote HTTP Oracle delegation a package-level
  exchange path.
- `e2e/frost/frost-threshold.test.ts` imports `buildOracleApp` from
  `@anchr/sdk/adapters/oracle-service`, so the FROST peer endpoint home must be
  preserved or replaced without breaking `deno task test:e2e:frost`.
- 0153 changes how the preserved FROST peer endpoints contact each other; this
  issue changes which HTTP endpoints remain a package surface.

## Acceptance

- No package-owned HTTP endpoint or client remains for Customer/Provider/Oracle
  preimage issuance or `/verify` delegation.
- The relay Oracle service is the only SDK-owned issuer for preimage or release
  material in the v0 exchange.
- The remaining FROST peer endpoint module exposes only FROST DKG, signing
  session, and signer round endpoints needed for Oracle-to-Oracle coordination.
- `test:e2e:frost` still has a supported FROST peer endpoint home.

## Verification

- `deno task test:e2e:frost`
- `deno task lint:strict`
- No matches are expected for HTTP exchange ownership:
  `rg "POST /verify|POST /hash|createHttpOracle|HttpOracleConfig" packages/sdk/src`

## Plan

- Split the current `oracle-service` composition so FROST peer endpoints remain
  available without registering HTLC exchange routes.
- Remove HTTP Oracle client/config exports and migrate callers to relay Oracle
  exchange or explicit application-owned static registry composition.
- Update tests and examples that import the removed HTTP exchange surface.
