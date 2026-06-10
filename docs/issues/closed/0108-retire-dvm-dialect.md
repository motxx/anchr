# Retire the Dvm dialect and port region privacy onto the canonical advertisement

Created: 2026-06-10
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0107

Blocks:
- 0103
- 0109

## Summary

Port region-scoped discovery (region tag + optional region-key content
encryption) onto the canonical `@anchr/protocol` advertisement, spec the
region layer in `specs/paid-request-exchange.md`, then delete
`adapters/nostr/{customer,provider}-service.ts`, the `Dvm*` payload shapes,
and the singleton-pool transport in favor of the `RelayClient` port.

## Rationale

`docs/lifecycle-unification-design.md` step 5 (P4). The Dvm dialect is the
last second wire surface after #0102; its only production consumers are the
adapter-world orchestrators that 0107 replaces. Region privacy must survive
the deletion, not die with it.

## Acceptance

- Region discovery and region-key encryption work against the canonical
  advertisement and are documented in `specs/`.
- `adapters/nostr/customer-service.ts`, `provider-service.ts`, the `Dvm*`
  payload types, and `adapters/nostr/transport/client.ts` are deleted.
- E2E parity: protocol, relay, and regtest buckets green before and after.

## Verification

- No matches are expected: `rg -n "Dvm(Query|Offer|Selection)" packages/sdk/src`
- `deno task test:all` and `deno task test:all:docker`

## Plan

- Spec the region layer first, port discovery, then delete in one slice per
  service file with e2e green between slices.
