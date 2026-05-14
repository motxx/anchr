# Resilience Checklist

Use this checklist as the current entry point for Anchr resilience review. The
older [`docs/chaos-engineering-report.md`](chaos-engineering-report.md) is a
historical 2026-04-06 snapshot and should not be used as current code guidance.

## Current References

- Architecture and role boundaries: [`docs/architecture.md`](architecture.md)
- Universal lifecycle and state vocabulary:
  [`specs/protocol-contract.md`](../specs/protocol-contract.md)
- Nostr transport, release retry, and recovery:
  [`specs/messaging.md`](../specs/messaging.md)
- Security invariants and required test pins:
  [`docs/threat-model.md`](threat-model.md)
- Current `@anchr/bounty` state transitions:
  `packages/bounty/src/domain/query-transitions.ts`

## Review Checklist

- Confirm new public docs use Customer, Provider, and Oracle vocabulary.
- Confirm Provider response vocabulary uses offer terms such as `ProviderOffer`,
  `offer_event_id`, `offers`, and `awaiting_offers`.
- Confirm docs and runbooks reference current `packages/bounty/src/...` paths,
  not old top-level `src/...` locations.
- Confirm release-material delivery follows the Nostr-native retry and recovery
  rules in `specs/messaging.md`.
- Confirm security-sensitive resilience claims map to
  `docs/threat-model.md` invariants or get a new issue before publication.
- Confirm implementation-specific local states are not presented as universal
  protocol states; use `specs/protocol-contract.md` for cross-implementation
  lifecycle language.

## Verification Commands

- `deno task lint:strict`
- `deno task test:e2e:protocol`
- `deno task test:e2e:relay` when relay-backed behavior changes.
- `deno task test:e2e:regtest` when Cashu, Blossom, or full bounty lifecycle
  behavior changes.
- `deno task test:e2e:tlsn` when TLSNotary proof generation or verification
  changes.
