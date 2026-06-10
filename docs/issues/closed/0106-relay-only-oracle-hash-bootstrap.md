# Relay-only Oracle hash bootstrap over NIP-44 DM

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

feature

## Dependencies

Depends on:
- 0104

Blocks:
- 0103
- 0107

## Summary

Specify and implement the Customer→Oracle hash request/response as NIP-44 DM
payloads so the whole lifecycle can complete relay-only (P2). The DM adapter
becomes the default `OracleClient`; the HTTP `/hash` client remains an
optional adapter.

## Rationale

P2 in `docs/lifecycle-unification-design.md`. Today the hash bootstrap is
HTTP-only (`packages/sdk/src/oracle.ts` `createHttpOracleClient`, duplicated
in `adapters/nostr/customer-service.ts`), which exposes the Customer's
network address to the Oracle and requires the Oracle to run a reachable
HTTP endpoint. The preimage-delivery DM in `specs/` is the precedent shape.

## Acceptance

- `specs/` documents the hash request/response DM payloads.
- A DM-based `OracleClient` adapter exists and is the default.
- The HTTP client remains available as an injected option only.
- INV-08 (relay-only lifecycle) test passes using the DM adapter.

## Verification

- `deno task test:e2e:protocol`
- `deno task test:unit`
- Manual: spec section review against the implementation field names.

## Plan

- Draft the DM payload spec next to the preimage-delivery spec section.
- Implement the adapter behind the existing `OracleClient` seam.
- Switch the default wiring and update the INV-08 test to drop any HTTP stub.

## Resolution

Implemented by updating:

- `packages/protocol/src/events.ts` — canonical NIP-44 kind 4 wire shapes:
  `HashRequestPayload`/`HashResponsePayload` with build/parse helpers;
  parsers are type-discriminated and reject other DM payloads (locked by
  tests in `events.test.ts`).
- `packages/sdk/src/oracle.ts` — `createNostrOracleClient` (fresh ephemeral
  sender per request, response await with timeout, loud failures via
  `OracleTimeoutError`/`OracleResponseError`).
- `packages/sdk/src/adapters/nostr/hash-responder.ts` — `serveHashRequests`
  Oracle-side responder, idempotent per `query_id`, hash issuance injected
  via `issueHash` so the HTTP route's `PreimageStore.create` semantics plug
  straight in.
- `packages/sdk/src/customer.ts` / `customer-types.ts` — `CustomerOracle.client`
  is now optional; a missing client defaults to the relay-DM bootstrap over
  the Customer's `relayClient`. HTTP remains an explicit override.
- `e2e/protocol/anonymous-relay-flow.test.ts` — INV-08 now exercises the
  default DM bootstrap end-to-end (no injected client, responder over the
  in-memory relay).
- `packages/sdk/src/oracle-nostr.test.ts` — round trip, idempotency, and
  timeout unit tests.
- `specs/messaging.md` — "Hash Bootstrap (kind 4)" section + canonical owner
  table row; `README.md` — the API sketch uses the DM default.
- `docs/threat-model.md` + lock — INV-08 claim strengthened to name the DM
  bootstrap as the default path.

Verified with:

- `deno task test:all`
- `deno task lint:invariants`
- `deno task test:e2e:protocol` (INV-08 with the default DM client)

Harness update:

- INV-08's locking test now covers the default bootstrap path; protocol
  events tests lock the DM payload discrimination.

Review residuals:

- None

Follow-up:

- None
