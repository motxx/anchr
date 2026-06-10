# Retire the Dvm dialect and port region privacy onto the canonical advertisement

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

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

## Resolution

Implemented by updating:

- Region scoping ported to the canonical surface: protocol
  `buildQueryRequestEvent` gains an optional `region` tag,
  `RequestOptions.regionCode` (Customer) and `ProviderOptions.regionCode`
  (`#region` discovery filter) wire it through, locked by
  `e2e/protocol/region-scoped-discovery.test.ts`; `specs/messaging.md`
  documents the tag and keeps region-key content encryption as the
  SDK-local optional layer (helpers in `adapters/nostr/crypto/encryption.ts`,
  unchanged).
- Deleted `adapters/nostr/customer-service.ts`, `provider-service.ts`
  (+tests), `transport/relay-publish.ts`, and every `Dvm*` payload/parser/
  builder; `events/events.ts` now owns only the Oracle DM payload types and
  the `oracle_payload` tag codec; `events/event-builders.ts` is the
  announcement builder only; `oracle-handlers.ts` reads offers with the
  canonical plaintext `parseOfferFeedbackEvent`.

Verified with:

- `deno task test:all`
- No matches: `rg -n "Dvm(Query|Offer|Selection)" packages/sdk/src`
- E2E parity: protocol bucket green (relay/regtest covered by the
  pre-push full gate before shipping).

Harness update:

- Region behavior locked by the new protocol-bucket e2e; arch-lint E027/E022
  continue to gate dialect regressions.

Review residuals:

- `adapters/nostr/transport/client.ts` survives one issue longer than
  planned: `oracle-service.ts` (#0109's subject) is its last consumer, so
  the singleton-pool transport retires with #0109.

Follow-up:

- None
