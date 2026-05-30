# Protocol Conformance Audit

Created: 2026-05-30

This audit maps the active protocol specs to current implementation and test
owners after the SDK/protocol package collapse. It is a traceability document,
not a new protocol contract.

## Summary

The current implementation is centered on two public packages:

- `@anchr/protocol` owns role-neutral wire helpers, Nostr primitives, schema
  URL validation, and protocol types.
- `@anchr/sdk` owns Customer, Provider, Oracle orchestration, adapters,
  payments, proof dispatch, attachments, local state, and test helpers.

The audit found no missing package import or type owner for the collapsed
layout. It did find two conformance gaps that should remain tracked before the
public-release parent closes:

- #0094: standardize completion feedback and release retry semantics that are
  intentionally left out of the current Nostr messaging profile.
- #0093: decide whether the conditional-swap spec is active public protocol or
  retained design material, then update implementation/docs accordingly.

## Spec Mapping

| Spec | Implementation owner | Test owner | Audit finding |
| --- | --- | --- | --- |
| `specs/protocol-contract.md` | `packages/sdk/src/customer.ts`, `packages/sdk/src/provider.ts`, `packages/sdk/src/oracle.ts`, `packages/sdk/src/requests/`, `packages/sdk/src/payments/`, `packages/sdk/src/proofs/` | `packages/sdk/src/customer.test.ts`, `packages/sdk/src/provider.test.ts`, `packages/sdk/src/integration.test.ts`, `packages/sdk/src/requests/application/query-service.test.ts`, `e2e/protocol/` | Lifecycle, proof dispatch, escrow verification, release, and attack invariants are represented in SDK code and protocol e2e tests. Local state names intentionally differ from the role-neutral spec. |
| `specs/messaging.md` | `packages/protocol/src/events.ts`, `packages/protocol/src/nostr.ts` for canonical query/result/feedback/release wire helpers; `packages/sdk/src/adapters/nostr/` for SDK relay services and Oracle announcements | `packages/protocol/src/events.test.ts`, `packages/protocol/src/nostr.test.ts`, `packages/sdk/src/adapters/nostr/*.test.ts`, `e2e/relay/oracle-discovery.test.ts` | Event kind constants, request/result/feedback builders, NIP-44 payload helpers, Oracle-readable result payloads, and discovery events are implemented and tested. Completion feedback and release retry-store semantics remain tracked by #0094. |
| `specs/oracle-registry.md` | `packages/sdk/src/adapters/oracle-client/oracle-discovery.ts`, `packages/sdk/src/adapters/nostr/events/event-builders.ts` | `packages/sdk/src/adapters/oracle-client/oracle-discovery.test.ts`, `e2e/relay/oracle-discovery.test.ts` | Kind `30088`, `d` tag, `anchr-oracle` and capability `t` tags, announcement content fields, capability filtering, and recency filtering are implemented and tested. |
| `specs/proof-schemas.md` | `packages/protocol/src/schema.ts`, `packages/sdk/src/schema.ts`, `packages/sdk/src/proofs/` | `packages/protocol/src/schema.test.ts`, `packages/sdk/src/schema.test.ts`, proof adapter tests under `packages/sdk/src/proofs/` | HTTPS schema URL shape, exact dispatch, built-in TLSN and C2PA URLs, and adapter `canHandle` dispatch are implemented and tested. |
| `specs/conditional-swap.md` | `packages/sdk/src/payments/frost-*`, `packages/sdk/src/requests/application/escrow-flow-methods.ts`, `e2e/regtest/frost-p2pk-cashu.test.ts` | `packages/sdk/src/payments/frost-*.test.ts`, `e2e/frost/frost-threshold.test.ts`, `e2e/regtest/frost-p2pk-cashu.test.ts` | FROST/P2PK settlement pieces and regtest coverage exist, but the spec still names removed package surfaces and broader N:M swap concepts that are not a current public package. Tracked by #0093. |

## Wire Behavior Notes

`@anchr/protocol/events` is the public role-neutral event helper surface for
query, result, feedback, and preimage delivery messages. It builds NIP-90 kind
`5300`, `6300`, and `7000` events, signs them, emits request and proof schema
tags, validates parser shape, and supports Oracle-readable encrypted result
payloads.

`@anchr/sdk/adapters/nostr` contains adapter-level Nostr transport helpers,
service wiring, and Oracle announcement publishing. Its query/result/feedback
builders remain internal SDK service plumbing, not a second public wire
contract.

Provider release handling is represented by preimage DMs in the protocol
helpers and by SDK Provider wait loops. Completion feedback, FROST release
standardization, and retry-store/deletion rules remain deliberate follow-up
work in #0094.

## Security And Settlement Coverage

The security-sensitive surfaces map to existing tests:

- forged proof rejection: `docs/threat-model.md` `INV-01`, proof verifier
  tests, and protocol attack e2e tests.
- rejected verification does not leak preimages: `INV-02` and
  `e2e/protocol/bounty-attacks.test.ts`.
- refund-before-locktime rejection and Provider-bound redemption:
  `INV-03`/`INV-04`, payment unit tests, and regtest e2e tests.
- FROST threshold behavior: `e2e/frost/frost-threshold.test.ts` and
  `packages/sdk/src/payments/frost-*.test.ts`.

## Follow-Up Gate

Before `docs/issues/pending/0080-prepare-public-release-cleanup.md` closes,
the repository should either close #0093 and #0094 or explicitly decide that
one of them is not public-release blocking.
