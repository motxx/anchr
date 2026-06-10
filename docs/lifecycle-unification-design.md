# Anonymous Paid-Request Lifecycle Unification

Design for collapsing the SDK's two Customer/Provider/Oracle orchestration
implementations into one lifecycle engine behind the existing public SDK
surface, without weakening the anonymous relay-only P2P exchange that Anchr
is built around.

## Goal

One implementation owns the paid-request lifecycle (advertise → offer →
select → execute → release → redeem/refund). The public SDK surface
(`createCustomer`, `createProvider`, `createOracle*`, `@anchr/sdk` root
exports) does not change. `@anchr/protocol` stays the only wire codec.

## Privacy invariants (non-negotiable)

These properties define the cypherpunk core of the exchange. The unified
engine must preserve every one of them, and each gets a locking test before
the implementation that satisfies it is allowed to replace the old path.

| # | Invariant | Mechanism | Locking test |
| --- | --- | --- | --- |
| P1 | Actor identities are ephemeral per request: two requests from the same actor are unlinkable by key material. | Fresh keypair per lifecycle by default (today: `adapters/nostr/crypto/identity.ts`); persistent keys are an explicit opt-in. | New unit test: two sequential `request()` calls publish under distinct pubkeys unless a signer is injected. |
| P2 | The full lifecycle can complete relay-only: no actor is required to accept inbound HTTP or learn a counterparty's network address. | Nostr events + NIP-44 DMs for every actor-to-actor step, including the Customer→Oracle hash bootstrap. The HTTP Oracle client remains an optional adapter, never the only path. | New protocol-bucket e2e: full Customer/Provider/Oracle exchange against an in-process relay with no HTTP listener. |
| P3 | The Public Request Advertisement carries no payment-bearing or execution material (ADR 0002). | `parseQueryRequestEvent` rejects advertisements containing predicate/context/mint/locktime/payment-lock fields. | `packages/protocol/src/events.test.ts` (exists). |
| P4 | Relay operators learn at most the advertisement metadata; optional region scoping hides even that from out-of-region observers. | Region-derived shared-key encryption (`deriveRegionKey`) as an optional advertisement privacy layer; region tag for discovery filtering. | Existing `crypto/encryption.ts` tests, plus an engine-level test that region mode round-trips discovery. |
| P5 | Settlement is bearer and identity-free: Payment Locks bind to ephemeral keys only. | Cashu HTLC/P2PK with the request's ephemeral keys; no account, no registration, no KYC surface anywhere in the engine. | `e2e/regtest/regtest-htlc-trustless.test.ts` (exists). |
| P6 | Oracle release decisions are publicly verifiable without identifying the Customer or Provider beyond their ephemeral keys. | Kind 30103 attestation events (plaintext, signature-checkable), kind 30088 announcements for registry-free Oracle discovery. | `e2e/relay/oracle-discovery.test.ts` + attestation tests (exist). |

Threat-model entries: P1/P2 become declared invariants (`INV-07`,
`INV-08`) when their locking tests land, following the INV process in
`docs/threat-model.md`.

## Current state

Two implementations exist:

- **Root world** — `customer.ts` / `provider.ts` / `oracle.ts` behind
  `index.ts`. Speaks the canonical `@anchr/protocol` contract (P3 enforced).
  Uses inline state machines, direct `Date.now()`/`Math.random()`, and an
  HTTP-only Oracle hash bootstrap (P2 not satisfied alone).
- **Adapter world** — `adapters/nostr/{customer,provider,oracle}-service.ts`
  over the `requests/` application layer. Owns the anonymity machinery
  (ephemeral identity, region keys, DM-based Oracle delivery, attestations)
  but speaks the non-canonical `Dvm*` payload dialect and has no production
  consumer besides its own barrel.

Neither world alone satisfies all six invariants. The unification target
takes the root world's wire contract and public API, the adapter world's
privacy machinery, and the `requests/` layer's injection discipline
(`Clock`, `IdGenerator`, ports).

## Target architecture

```
index.ts (public API, unchanged)
  └── lifecycle engine (requests/ application layer; injected Clock/IdGenerator)
        ├── @anchr/protocol          — only wire codec (P3)
        ├── identity policy          — ephemeral-by-default keys (P1)
        ├── RelayClient port         — SimplePool adapter / in-memory adapter
        ├── Oracle coordination port — Nostr DM adapter (default, P2)
        │                             HTTP adapter (optional)
        ├── EscrowProvider port      — Cashu HTLC / FROST P2PK (P5)
        └── advertisement privacy    — optional region-key layer (P4)
```

ADR 0001 holds: the ports are I/O and test boundaries, not substrate
replacement promises. Nostr and Cashu remain fixed for v0.

## Migration steps

Each step is an independently verifiable change (own issue, own tests, full
`deno task test:all` + Docker e2e gate). Order matters: privacy invariants
get their locking tests before any deletion.

1. **Lock the invariants.** Add the P1 and P2 tests against the current
   code (P2 initially exercises the adapter world's DM path). Declare
   INV-07/INV-08 in the threat model.
2. **Promote identity policy.** Move ephemeral-identity generation into the
   lifecycle engine as the default signer source; persistent signers become
   injected options. Root world and adapter world both consume it.
3. **Relay-only Oracle bootstrap.** Specify the Customer→Oracle hash
   request/response as NIP-44 DM payloads in `specs/` (alongside the
   existing preimage-delivery DM), implement it as the default
   `OracleClient` adapter, and demote HTTP to an optional adapter.
4. **Engine-backed public API.** Reimplement `createCustomer` /
   `createProvider` on the lifecycle engine (injected clock/ids, one
   subscribe-with-deadline helper instead of the repeated
   subscribe/timeout/close idiom), keeping the protocol package as codec.
   The root world's inline state machines retire here.
5. **Retire the Dvm dialect.** Port region-scoped discovery (P4) onto the
   canonical advertisement (region tag + optional region-key content
   encryption, spec'd in `specs/paid-request-exchange.md`), then delete
   `adapters/nostr/{customer,provider}-service.ts`, the `Dvm*` payloads,
   and the singleton-pool transport in favor of the `RelayClient` port.
   E2E parity (protocol + relay + regtest buckets green) gates the
   deletion.
6. **Single Oracle daemon.** `adapters/oracle-service/` (Hono) keeps the
   HTTP+FROST signer surface as the optional operator-facing adapter; its
   Nostr coordination moves onto the engine's DM adapter.

## Answer to the design question

The anonymous Nostr P2P exchange interface is preserved — and strengthened.
The public API does not change; what changes is that the anonymity
machinery stops being a parallel dialect and becomes the engine's default
behavior: ephemeral keys per request (P1), a lifecycle that completes
relay-only with no IP exposure between actors (P2), advertisement hygiene
already enforced by the protocol parser (P3), optional region privacy
against relay operators (P4), bearer settlement (P5), and publicly
verifiable release decisions (P6). Centralized conveniences (HTTP Oracle
endpoint) survive only as optional adapters behind ports, never as the
required path.
