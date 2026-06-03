# Resilience Checklist

Use this checklist as the current entry point for Anchr resilience review.
Historical chaos-report snapshots are intentionally not kept in the live docs
tree; current resilience claims must point at the references below.

## Current References

- Architecture and role boundaries: [`docs/architecture.md`](architecture.md)
- Paid-request exchange and redeem/refund rules:
  [`specs/paid-request-exchange.md`](../specs/paid-request-exchange.md)
- Nostr transport, release retry, and recovery:
  [`specs/messaging.md`](../specs/messaging.md)
- Security invariants and required test pins:
  [`docs/threat-model.md`](threat-model.md)
- SDK paid-request state transitions:
  `packages/sdk/src/requests/domain/query-transitions.ts`

## Review Checklist

- Confirm new public docs use Customer, Provider, and Oracle vocabulary.
- Confirm Provider response vocabulary uses offer terms such as `ProviderOffer`,
  `offer_event_id`, `offers`, and `awaiting_offers`.
- Confirm docs and runbooks reference public `@anchr/sdk` or `@anchr/protocol`
  surfaces unless they are documenting an internal maintenance task.
- Confirm release-material delivery follows the Nostr-native retry and recovery
  rules in `specs/messaging.md`.
- Confirm security-sensitive resilience claims map to
  `docs/threat-model.md` invariants or get a new issue before publication.
- Confirm implementation-specific local states are not presented as protocol
  states; use `specs/paid-request-exchange.md` for exchange language.

## Verification Commands

- `deno task lint:strict`
- `deno task test:e2e:protocol`
- `deno task test:e2e:relay` when relay-backed behavior changes.
- `deno task test:e2e:regtest` when Cashu, Blossom, or full paid-request
  lifecycle behavior changes.
- `deno task test:e2e:tlsn` when TLSNotary proof generation or verification
  changes.
