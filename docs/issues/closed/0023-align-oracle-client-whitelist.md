# Align oracle client whitelist

Created: 2026-05-15
Model: Codex (GPT-5)

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Align the customer SDK oracle API so `oracles` can represent a real multi-oracle trust policy without conflicting with the currently single-oracle `oracleClient` transport adapter.

Today `createCustomer()` accepts an `oracles` whitelist, but `pickOracleForRequest()` always selects the first entry and `oracleClient.requestHash(queryId)` has no selected-oracle argument. The bundled `createHttpOracleClient()` is also configured with one `oraclePubkey`, so `oracles: [A, B, C]` only works when the injected `oracleClient` returns `A`. A client wired for `B` or `C` fails with `OracleWhitelistMismatchError`.

## Rationale

The customer and provider must agree on trusted oracles: the customer publishes one `oracle_pubkey` in the query request, and the provider only offers when that pubkey is in its own whitelist.

The provider side already treats `oracles` as a whitelist gate in `packages/provider-sdk/src/provider.ts`. The customer side exposes the same whitelist concept, but the `OracleClient` interface in `packages/oracle-sdk/src/oracle.ts` cannot request a hash from a specific selected oracle. This makes the public API look multi-oracle while the practical customer implementation is single-oracle.

Relevant code:

- `packages/customer-sdk/src/customer.ts`: `pickOracleForRequest()` returns `oracles[0]`.
- `packages/customer-sdk/src/customer.ts`: `request()` rejects when `oracleClient.requestHash()` returns a pubkey different from the selected whitelist entry.
- `packages/oracle-sdk/src/oracle.ts`: `OracleClient.requestHash(queryId)` does not accept an oracle pubkey.
- `packages/oracle-sdk/src/oracle.ts`: `createHttpOracleClient()` takes one endpoint and one `oraclePubkey`.
- `packages/provider-sdk/src/provider.ts`: `canOfferForRequest()` checks whether the request oracle is in the provider whitelist.

## Plan

- Decide whether customer oracle transport should be modeled as a pubkey-indexed client map, structured oracle entries such as `{ pubkey, client }`, or a multi-oracle `OracleClient` method like `requestHash(queryId, oraclePubkey)`.
- Update `CustomerOptions`, `OracleClient`, and the bundled HTTP oracle adapter to make the selected oracle explicit at the transport boundary.
- Preserve the provider-side whitelist behavior and ensure customer request payloads still carry exactly one selected `oracle_pubkey`.
- Add focused tests for `oracles: [A, B]` proving the customer can select a trusted oracle and use the matching transport without false `OracleWhitelistMismatchError`.
- Update SDK README examples so single-oracle setup remains simple and multi-oracle setup is not misleading.

## Resolution

Completed: 2026-05-15

Implemented the structured-entry design:

- `CustomerOptions.oracles` is now the single source of truth for customer-side oracle trust: `[{ pubkey, client }]`.
- The customer still exposes `customer.oracles` as a readonly pubkey whitelist and publishes exactly one selected `oracle_pubkey` per request.
- `oracleSelector` can choose any trusted pubkey; the customer then calls the matching entry's client. If the selector returns a pubkey outside the configured list, construction-time trust is not expanded and the request fails.
- `OracleClient.requestHash(queryId)` now returns only `{ hash }`. Oracle identity is no longer duplicated in the transport interface or echoed by the HTTP adapter.
- `createHttpOracleClient({ endpoint })` remains endpoint-only. Multi-oracle routing is represented by multiple structured customer oracle entries, not by route tables inside the HTTP adapter.
- SDK docs, examples, regtest E2E, and README snippets were updated to the new API shape.

Harness updates:

- `packages/customer-sdk/src/customer.test.ts` covers structured oracle validation, duplicate pubkey rejection, non-first oracle selection, selector-outside-whitelist failure, and request publication of the selected oracle.
- `packages/oracle-sdk/src/oracle.test.ts` covers the endpoint-only HTTP adapter and hash-only response contract.
- `packages/customer-sdk/src/integration.test.ts` and regtest SDK E2E tests cover the new `OracleClient` signature.

Verification:

- `deno check packages/oracle-sdk/src/oracle.ts packages/customer-sdk/src/customer.ts packages/sdk/src/index.ts packages/customer-sdk/src/integration.test.ts packages/customer-sdk/src/customer.test.ts packages/oracle-sdk/src/oracle.test.ts e2e/regtest/sdk-integration.test.ts e2e/regtest/fiat-swap-square.test.ts`
- `deno test packages/oracle-sdk/src/oracle.test.ts packages/customer-sdk/src/customer.test.ts packages/customer-sdk/src/integration.test.ts --allow-env --allow-read --allow-net`
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys scripts/readme-snippets.test.ts`
- `deno task test:all`
- `deno task test:all:docker`

Review:

- `check-silent-bypass`: no silent-bypass patterns detected in the changed customer/oracle SDK trust-boundary files.

Follow-up:

- None.
