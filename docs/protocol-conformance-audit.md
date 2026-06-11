# Protocol Conformance Audit

Created: 2026-05-30

This audit maps the active protocol specs to current implementation and test
owners after the SDK/protocol package collapse. It is a traceability document,
not a new protocol contract.

## Summary

The current implementation is centered on two public packages:

- `@anchr/protocol` owns Nostr wire helpers, Nostr primitives, schema URL
  validation, Cashu settlement fields in wire payloads, and protocol types.
- `@anchr/sdk` owns Customer, Provider, Oracle orchestration, adapters,
  payments, proof dispatch, attachments, local state, and test helpers.

The audit found no missing package import or type owner for the collapsed
layout. Completion feedback, FROST release DMs, and retry-store semantics are
not conformance gaps because `specs/messaging.md` now excludes them from the
stable v0 Nostr profile and assigns them to SDK-local policy unless a future
profile promotes them.

## Spec Mapping

| Spec | Implementation owner | Test owner | Audit finding |
| --- | --- | --- | --- |
| `specs/paid-request-exchange.md` | `packages/sdk/src/customer.ts`, `packages/sdk/src/provider.ts`, `packages/sdk/src/oracle.ts`, `packages/sdk/src/requests/`, `packages/sdk/src/payments/`, `packages/sdk/src/proofs/` | `packages/sdk/src/customer.test.ts`, `packages/sdk/src/provider.test.ts`, `packages/sdk/src/integration.test.ts`, `packages/sdk/src/requests/application/query-service.test.ts`, `e2e/protocol/` | Paid-request exchange links, proof dispatch, Cashu escrow verification, release, and attack invariants are represented in SDK code and protocol e2e tests. Local state names intentionally differ from spec exchange terms. |
| `specs/messaging.md` | `packages/protocol/src/events.ts`, `packages/protocol/src/nostr.ts` for canonical query/result/feedback/HTLC preimage release wire helpers; `packages/sdk/src/adapters/nostr/` for SDK relay services, Oracle announcements, FROST release DMs, and retry policy | `packages/protocol/src/events.test.ts`, `packages/protocol/src/nostr.test.ts`, `packages/sdk/src/adapters/nostr/*.test.ts`, `e2e/relay/oracle-discovery.test.ts` | Event kind constants, request/result/feedback builders, NIP-44 payload helpers, Oracle-readable result payloads, HTLC preimage DMs, SDK-local FROST DMs, and discovery events are implemented and tested. Completion feedback and retry-store semantics are explicitly outside the stable v0 profile. |
| `specs/oracle-registry.md` | `packages/sdk/src/adapters/oracle-client/oracle-discovery.ts`, `packages/sdk/src/adapters/nostr/events/event-builders.ts` | `packages/sdk/src/adapters/oracle-client/oracle-discovery.test.ts`, `e2e/relay/oracle-discovery.test.ts` | Kind `30088`, `d` tag, `anchr-oracle` and capability `t` tags, announcement content fields, capability filtering, and recency filtering are implemented and tested. |
| `specs/proof-schemas.md` | `packages/protocol/src/schema.ts`, `packages/sdk/src/schema.ts`, `packages/sdk/src/proofs/` | `packages/protocol/src/schema.test.ts`, `packages/sdk/src/schema.test.ts`, proof adapter tests under `packages/sdk/src/proofs/` | HTTPS schema URL shape, exact dispatch, built-in TLSN and C2PA image URLs, third-party schema URL acceptance, and adapter `canHandle` dispatch are implemented and tested. |

## Wire Behavior Notes

`@anchr/protocol/events` is the public Nostr event helper surface for query,
result, feedback, and preimage delivery messages. It builds NIP-90 kind
`5300`, `6300`, and `7000` events, signs them, emits request and proof schema
tags, validates parser shape, and supports Oracle-readable encrypted result
payloads.

`@anchr/sdk/adapters/nostr` contains adapter-level Nostr transport helpers,
service wiring, and Oracle announcement publishing. Its query/result/feedback
builders remain internal SDK service plumbing, not a second public wire
contract.

Provider release handling is represented by HTLC preimage DMs in the protocol
helpers and by SDK Provider wait loops. FROST release DMs are SDK-local adapter
policy with coverage in `packages/sdk/src/adapters/nostr/events/frost-dm.test.ts`
and `packages/sdk/src/adapters/nostr/oracle-frost.test.ts`. Completion feedback
and retry-store/deletion rules are explicitly outside the stable v0 profile.

## Conditional Swap Status

`docs/conditional-swap-design.md` is retained N:M conditional settlement design
material. It is not an active Anchr v0 protocol spec, not part of the current
`@anchr/protocol` wire contract, and not a conformance target for compatible
paid-request implementations.

## Security And Settlement Coverage

The security-sensitive surfaces map to existing tests:

- forged proof rejection: `docs/threat-model.md` `INV-01`, proof verifier
  tests, and protocol attack e2e tests.
- rejected verification does not leak preimages: `INV-02` and
  `e2e/protocol/paid-request-attacks.test.ts`.
- refund-before-locktime rejection and Provider-bound redemption:
  `INV-03`/`INV-04`, payment unit tests, and regtest e2e tests.
- FROST threshold behavior: `e2e/frost/frost-threshold.test.ts` and
  `packages/sdk/src/payments/frost-*.test.ts`.

## Privacy Boundary Test Owners

Each Nostr message class has one stated privacy model in
`specs/messaging.md` and one test owner that locks it:

| Message class | Privacy model | Test owner |
| --- | --- | --- |
| Request `5300` content | Public signed JSON; payment-bearing and execution field names rejected by the parser | `packages/protocol/src/events.test.ts` — public-allowlist and per-field rejection tests |
| Offer `7000` content | Public signed JSON; `provider_pubkey` must match the event author | `packages/protocol/src/events.test.ts` |
| Selection `7000` content | NIP-44 encrypted to the selected Provider; `p` tag binding checked | `packages/protocol/src/events.test.ts` |
| Result `6300` content | NIP-44 encrypted to the Customer | `packages/protocol/src/events.test.ts` |
| `oracle_payload` tag | NIP-44 encrypted to the Oracle | `packages/protocol/src/events.test.ts` |
| Release DM kind `4` | NIP-44 encrypted Oracle→Provider | `packages/protocol/src/events.test.ts` |
| Key-material unlinkability across requests | Fresh ephemeral keypair per request | `docs/threat-model.md` `INV-07`, `packages/sdk/src/customer.test.ts` |
| Relay-only exchange | No actor requires an HTTP endpoint | `docs/threat-model.md` `INV-08`, `e2e/protocol/anonymous-relay-flow.test.ts` |

## Follow-Up Gate

No protocol-conformance follow-up remains open in this audit. Public-release
cleanup may still depend on separate SDK/API, vocabulary, quick-start, and
layout issues.
