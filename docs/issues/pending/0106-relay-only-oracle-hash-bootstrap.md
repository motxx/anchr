# Relay-only Oracle hash bootstrap over NIP-44 DM

Created: 2026-06-10
Model: Claude Fable 5

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
