# Delete HTTP Oracle exchange surface

Created: 2026-06-13
Model: GPT-5.4-Codex
Completed: 2026-06-13

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

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/oracle-service/server.ts`
- `packages/sdk/src/adapters/oracle-service/index.ts`
- `packages/sdk/src/adapters/oracle-service/htlc-routes.ts` (deleted)
- `packages/sdk/src/adapters/oracle-service/server.test.ts` (deleted)
- `packages/sdk/src/adapters/oracle-client/index.ts`
- `packages/sdk/src/adapters/oracle-client/http-oracle.ts` (deleted)
- `packages/sdk/src/adapters/oracle-client/http-oracle.test.ts` (deleted)
- `packages/sdk/src/adapters/oracle-client/config-loader.ts` (deleted)
- `packages/sdk/src/adapters/oracle-client/config-loader.test.ts` (deleted)
- `packages/sdk/src/oracle.ts`
- `packages/sdk/src/oracle.test.ts` (deleted)
- `packages/sdk/src/index.ts`
- `packages/sdk/src/index.test.ts`
- `packages/sdk/src/adapters/nostr/mod.ts`
- `packages/sdk/README.md`
- `docs/issues/pending/0143-premise-alignment-restructuring-plan.md`

The `@anchr/sdk/adapters/oracle-service` `buildOracleApp` entrypoint now
composes only the FROST DKG, coordinator signing, and signer round endpoints.
The relay Oracle service in `@anchr/sdk/adapters/nostr` remains the SDK owner
for exchange preimage and release-material issuance. The regtest, tlsn, and
protocol e2e suites did not import the deleted HTTP exchange surface; their
attack and vulnerability coverage uses in-process registries or relay-owned
Oracle behavior, so no exchange attack test was weakened or removed.

Verified with:

- `deno task check`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `rg "POST /verify|POST /hash|createHttpOracle|HttpOracleConfig" packages/sdk/src` (no matches)
- `rg -l "preimage" packages/sdk/src/adapters/` confirmed the deleted
  `adapters/oracle-service` issuer is gone; remaining matches are relay Oracle
  issuance under `adapters/nostr` plus Cashu payment redemption contracts and
  tests that consume a preimage, not a second Oracle exchange issuer.
- `check-silent-bypass` review of the changed non-test package files: no
  silent-bypass patterns detected.
- `arch-lint-llm` review of the changed non-test package files after
  `deno task lint:arch --errors-only`: no semantic architecture violations
  detected.

Harness update:

- The issue's negative HTTP exchange guard is now satisfied by
  `rg "POST /verify|POST /hash|createHttpOracle|HttpOracleConfig" packages/sdk/src`;
  `server-frost.test.ts` and `test:e2e:frost` lock the reduced FROST endpoint
  home. The literal `preimage` scan remains useful with the documented Cashu
  redemption exception above.

Review residuals:

- The literal `rg -l "preimage" packages/sdk/src/adapters/` scan still reports
  Cashu adapter redemption files because payment redemption must consume a
  preimage. No HTTP Oracle exchange issuer remains.

Follow-up:

- None
