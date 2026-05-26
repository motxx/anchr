# Universal Protocol Contract

## Abstract

This spec defines the protocol rules that every independent Anchr Customer,
Provider, and Oracle implementation must share. Concrete transports, settlement
backends, proof engines, storage services, and product adapters may vary, but
they must preserve these lifecycle, validation, and settlement contracts to
interoperate.

Transport profiles such as [`messaging.md`](messaging.md) bind this contract to
specific wire events. Primitive packages and adapters document their internal
APIs in their own `SPEC.md` files.

## Actors

Anchr has three protocol actors:

| Actor    | Universal responsibility                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer | Publish a request, select a Provider, lock payment for the selected work, and refund only through the settlement timeout path.                            |
| Provider | Decide whether to offer work, verify selected escrow before irreversible work, submit proof material, and redeem only with spendable settlement material. |
| Oracle   | Verify proof material and release unlock material bound to the selected work.                                                                             |

A deployment may bundle actors or expose adapter endpoints, but that deployment
is not a fourth protocol actor.

## Lifecycle

The universal lifecycle is:

```text
request -> provider_offer -> selection -> provider_preflight -> work
  -> proof_submission -> oracle_verification -> release -> redeem_or_refund
```

Implementations may model local state differently, but cross-actor messages must
preserve the causal links in this table:

| Step                  | Required causal link                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`             | Customer identity, query identifier, proof schema URL, verification requirements, acceptable Oracle authority, payment budget, and expiry.                  |
| `provider_offer`      | Provider identity, request reference, offered amount and conditions, and offer expiry when applicable.                                                      |
| `selection`           | Request reference, selected Provider identity, settlement lock reference, accepted amount, locktime, and encrypted execution context.                       |
| `provider_preflight`  | Local Provider ticket binding the selected settlement lock to the request, Provider identity, expected Oracle authority, and immutable spendability facts.  |
| `proof_submission`    | Request reference, selected Provider identity, proof schema URL, proof payload or attachment references, and encrypted key material for authorized readers. |
| `oracle_verification` | Proof verdict bound to the request, submitted proof, verifier policy, freshness context, and expected Oracle authority.                                     |
| `release`             | Unlock material bound to the selected settlement lock and signed by the expected Oracle authority or threshold group.                                       |
| `redeem_or_refund`    | Provider redeem before timeout when the selected lock is spendable; Customer refund only through the timeout path.                                          |

Transport profiles must define how these links are encoded and authenticated.
Local actor state such as retry queues, projections, and audit logs is not part
of the wire contract unless a profile explicitly serializes it.

## Message Contract

All interoperable profiles must provide these role-neutral message classes:

| Message           | Minimum fields                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Request`         | `query_id`, Customer public key, proof schema URL, verification requirements, payment constraints, acceptable Oracle authority, visibility, expiry.                                 |
| `ProviderOffer`   | Request reference, Provider public key, amount, terms or notes, offer identifier.                                                                                                   |
| `Selection`       | Request reference, selected Provider public key, selected offer reference when available, settlement lock reference, encrypted execution context.                                   |
| `ProofSubmission` | Request reference, Provider public key, proof schema URL, proof bytes or attachment references, optional Provider notes.                                                            |
| `Release`         | `query_id`, request reference, settlement payment hash or equivalent lock identifier, Provider public key, authority public key or group key, unlock material, authority signature. |
| `Completion`      | Request reference, status, paid or refunded amount when known, and failure reason when the flow terminates without redeem.                                                          |

Public discovery fields are hints. When a profile carries both public tags and
encrypted content, execution must use the authenticated encrypted content and
treat public tags as untrusted discovery metadata.

## State Transitions

The shared lifecycle state machine is intentionally small:

```text
open
  -> offered
  -> selected
  -> working
  -> verifying
  -> release_available
  -> redeemed

open -> expired
selected -> expired
working -> expired
verifying -> rejected
release_available -> redeem_anomaly_recorded -> redeemed
```

Rules:

- `offered` may happen many times for one request.
- Exactly one Provider is selected for a 1:1 bounty settlement lock.
- `working` requires a successful Provider preflight ticket.
- `release_available` requires Oracle verification success and expected
  authority or threshold authorization.
- `redeem_anomaly_recorded` is not a failure state. It records that release
  correlation was not clean while the token remained economically spendable.
- `expired` is the Customer refund path. It must not allow the Customer to
  redeem before the settlement locktime.

Implementation-specific states such as current `awaiting_offers` or
`worker_selected` names are reference implementation details. New public SDK and
spec prose should use Customer, Provider, Oracle, request, offer, selection,
proof, release, and redeem vocabulary.

## Capability Requirements

The protocol depends on capabilities, not fixed implementations:

| Capability           | Universal contract                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor coordination   | Authenticated messages preserve role identity, causal parent links, replay context, and encrypted payload boundaries.                                    |
| Proof dispatch       | Requests and proofs carry an exact proof schema URL that selects a verifier without embedding verifier implementation details in the protocol.           |
| Settlement lock      | A selected Provider can redeem only with the bound unlock material and Provider authorization; the Customer can refund only after locktime.              |
| Release authority    | Unlock material is produced only after verification succeeds and is bound to the selected work and settlement lock.                                      |
| Attachment transport | Large or sensitive proof material is content-addressed or integrity-checked, encrypted for authorized readers, and referenced from the proof submission. |
| Local actor state    | Each actor persists enough state for idempotency, retries, preflight tickets, and audit records without making local storage a network actor.            |

An implementation may replace a reference profile when it satisfies the same
capability contract and any profile-specific spec it claims to implement.
Current repository bindings and package placement live in
[`docs/architecture.md`](../docs/architecture.md).

Reference implementations may expose machine-readable adapter manifests using
the package-level `AdapterManifest` contract in `@anchr/protocol/capabilities`.
Those manifests are not wire data; they are local conformance metadata for apps,
tests, and SDK composition.

## Provider Preflight

Before irreversible work, the selected Provider must validate the settlement
lock and record an immutable preflight ticket. A preflight report has:

| Field      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `ok`       | Whether the Provider may begin irreversible work.                 |
| `errors`   | Hard failures that prevent work.                                  |
| `warnings` | Non-fatal risks that should be recorded before work.              |
| `details`  | Parsed settlement and request facts used to explain the decision. |

The ticket must bind at least:

- `query_id`
- original request reference
- selected Provider public key
- expected Oracle public key or threshold group key
- settlement backend identifier
- payment hash or equivalent lock identifier
- token or lock fingerprint
- accepted amount
- locktime
- accepted offer amount when available
- Provider policy version at preflight time

If the ticket cannot be created, the Provider declines selection and does not
start work. Provider policy is closed at preflight. Later policy changes may
affect future offers, clean-settlement reporting, and reputation, but must not
block recovery of funds from an already accepted spendable lock.

## Release And Redeem

Provider settlement separates three decisions:

| Decision                           | Hard gate? | Purpose                                                                                                                                                    |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mint-level or backend-level redeem | Yes        | Check token or lock spendability: matching unlock material, selected Provider binding, Provider authorization, and backend acceptance.                     |
| Clean settlement                   | No         | Check expected authority and signature binding to `query_id`, request reference, payment hash, and Provider public key.                                    |
| Audit and reputation               | No         | Record source mismatch, signature mismatch, stale reply threads, `query_id` mismatch, request-reference mismatch, short locktime, or implementation drift. |

Unexpected release material is not a clean valid release. If the material still
unlocks the Provider's currently held bound token or lock and the Provider can
authorize redeem, the Provider should attempt economic redeem and record the
correlation problem as audit evidence.

Redeem fails when the unlock material does not match the held lock, the lock is
not bound to the selected Provider, the Provider cannot authorize the redeem, or
the settlement backend rejects the spend.

Oracle release depends on proof validity and expected authority. A host,
coordinator, adapter, or Customer cancel observed after proof verification must
not suppress release material for valid completed work.

## Security Invariants

Security claims live in [`docs/threat-model.md`](../docs/threat-model.md), not
in this spec. This spec depends on those invariants:

| Threat-model invariant | Protocol surface                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `INV-01`               | Oracle proof verification must reject forged TLSNotary presentations before release. |
| `INV-02`               | Oracle wrappers must not expose preimages when verification fails.                   |
| `INV-03`               | Customer refund before locktime must be rejected by the settlement backend.          |
| `INV-04`               | Stolen preimage alone must not redeem Provider-bound escrow.                         |

When a new universal security property is needed, add or update the threat-model
invariant and its tests before relying on it from this spec.

## Reference Implementation Traceability

Reference implementations should make their relationship to this spec explicit
without copying normative text into lower-level docs:

- Package `SPEC.md` files should include a short "Implements" section naming the
  spec section and the package API or adapter that implements it.
- Tests that pin a universal protocol behavior should include the spec section
  or threat-model invariant in the test name or nearby assertion message.
- Adapter profiles should link to this document and then define only the
  profile-specific encoding, authentication, retry, and discovery rules.
- If a package deliberately implements only part of a capability, its `SPEC.md`
  should say which capability remains adapter-owned.

This traceability policy is documentation guidance. Deterministic security
invariant drift is enforced separately by `deno task lint:invariants`.

## Adapter Profiles

Universal contract belongs in this file and related `specs/` documents. Concrete
profiles belong in separate specs or package docs:

| Profile type                                                      | Home                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Nostr event kinds, tags, NIP-44 payloads, and relay behavior      | [`messaging.md`](messaging.md)                                          |
| Proof schema URL identity and dispatch                            | [`proof-schemas.md`](proof-schemas.md)                                  |
| Oracle discovery announcements                                    | [`oracle-registry.md`](oracle-registry.md)                              |
| Cashu HTLC / P2PK implementation details                          | `packages/core-cashu/SPEC.md` and package tests                         |
| TLSNotary, C2PA, GPS, ProofMode verifier behavior                 | Owning package `SPEC.md` and tests                                      |
| Blossom or other attachment backend details                       | Adapter or package docs; only interoperable profiles belong in `specs/` |
| MCP, HTTP gateway, CLI, mobile, web, Discord, or hosted endpoints | Adapter package docs, `apps/<app>/`, or `examples/<name>/`              |

Adapter or example choices must not become protocol requirements unless they are
promoted into `specs/` as an interoperability profile.
