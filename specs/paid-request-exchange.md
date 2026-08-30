# Paid Request Exchange

## Abstract

Anchr v0 is a Nostr-native, Cashu-settled protocol for verifiable paid requests.
A Customer publishes a paid request, Providers offer to complete it, the
Customer selects exactly one Provider, the selected Provider submits work with
proof material, and an Oracle releases Cashu unlock material only after
verification succeeds.

This specification defines how the Paid Request exchange keeps proof
verification and payment release linked. [`messaging.md`](messaging.md) defines
its Nostr/NIP-90 event encoding.

## Substrate

Anchr v0 has fixed substrates:

| Surface            | v0 substrate        |
| ------------------ | ------------------- |
| Actor coordination | Nostr/NIP-90 events |
| Payment Lock       | Cashu HTLC/P2PK     |

SDK relay and payment ports are I/O and test boundaries. They are not a public
promise that another transport or settlement backend can be substituted without
a new versioned protocol decision.

## Actors

Anchr has three protocol actors:

| Actor    | Responsibility                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer | Publish a paid request, select one Provider, lock payment for that Provider, and refund only through the Cashu timeout path.                              |
| Provider | Offer work, accept Provider-only redemption data after selection, submit work with proof material, and redeem the Cashu Payment Lock after valid release. |
| Oracle   | Verify proof material and release Cashu unlock material bound to the selected work.                                                                       |

A deployment may bundle actors or expose adapter endpoints, but that deployment
is not a fourth protocol actor.

## Exchange

The v0 exchange is:

```text
request -> provider_offer -> provider_selection -> work
  -> proof_submission -> oracle_verification -> release -> redeem_or_refund
```

Each step must preserve these links:

| Step                  | Required link                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`             | Request Notice with Customer pubkey, query id, Proof Schema URL, Oracle pubkey, Payment Budget, and offer expiry.                                                                          |
| `provider_offer`      | Provider pubkey, request event reference, Requested Payment Amount, and offer status.                                                                                                      |
| `provider_selection`  | Request event reference, selected Provider pubkey, encrypted Provider Redemption Token, and encrypted execution payload with predicate, Cashu mint URL, and Cashu locktime.                |
| `proof_submission`    | Request event reference, selected Provider identity, Proof Schema URL, proof payload or attachment references, Customer-readable encrypted content, and Oracle-readable encrypted content. |
| `oracle_verification` | Proof decision made against the request, Proof Schema, predicate, submitted proof material, and expected Oracle authority.                                                                 |
| `release`             | Release Material sent by the expected Oracle to the selected Provider and bound to the query and request event.                                                                            |
| `redeem_or_refund`    | Provider redeems before locktime with valid Release Material and Provider authorization, or Customer refunds through the Cashu timeout path.                                               |

Local actor state such as retry queues, projections, preflight records, and
audit logs is not part of the exchange specification unless it is serialized in
the Nostr event encoding.

## Cashu Payment Lock

A v0 Payment Lock is a Cashu HTLC/P2PK lock. The selected Provider can redeem it
only by presenting valid Release Material and satisfying the Provider P2PK
binding. The Customer can recover funds only through the Cashu timeout path.

The Request Notice carries only the Payment Budget needed for discovery and
offer evaluation. Provider-only payment data and payment-lock terms are
delivered after Provider Selection as encrypted Provider-only content. The
Provider Redemption Token must not appear in public relay-visible content.

The v0 Cashu Payment Lock must preserve these properties:

- the lock is associated with one request and one Customer-selected Provider;
- the lock amount matches the selected Provider Offer's Requested Payment
  Amount;
- the lock has a refund locktime;
- the selected Provider needs both valid Release Material and Provider
  authorization to redeem before locktime;
- the Customer cannot redeem before locktime;
- the Oracle does not hold spend authority over the locked funds.

Cashu tokens exchanged in v0 use the V4 (`cashuB`) token serialization.
Implementations MUST emit V4 and SHOULD accept V3 (`cashuA`) on receive for
wallet interoperability.

## Release And Redeem

Release Material is Oracle-produced material that makes the selected Provider's
Provider Redemption Token redeemable after proof verification succeeds. In the
current Nostr event helper surface, HTLC release is delivered as an encrypted
preimage DM.

Provider settlement separates three decisions:

| Decision             | Hard gate? | Purpose                                                                                                                              |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Cashu redeem         | Yes        | Check token spendability: matching unlock material, selected Provider binding, Provider authorization, and mint acceptance.          |
| Clean settlement     | No         | Check expected authority and correlation to the query, request event, payment hash, and Provider pubkey.                             |
| Audit and reputation | No         | Record source mismatch, stale reply threads, query id mismatch, request-reference mismatch, short locktime, or implementation drift. |

Unexpected release material is not a clean valid release. If it still unlocks
the Provider's currently held Provider Redemption Token and the Provider can
authorize redemption, the Provider should attempt economic redeem and record the
correlation problem as audit evidence.

Redeem fails when the release material does not match the held lock, the token
is not bound to the selected Provider, the Provider cannot authorize the redeem,
or the Cashu mint rejects the spend.

Oracle release depends on proof validity and expected authority. A host,
coordinator, adapter, or Customer cancel observed after proof verification must
not suppress Release Material for valid completed work.

## FROST P2PK Settlement

For `p2pk_frost` settlement, the Provider Redemption Token is a Cashu NUT-11
P2PK token. Each proof MUST be locked to the selected Provider pubkey and the
FROST group pubkey with `n_sigs=2`, a Customer refund key, and the request
locktime. The lock uses NUT-11 `SIG_INPUTS` semantics.

The FROST group signs one message per proof:

```text
message_i = sha256(utf8(proof_i.secret))
```

The Oracle release material for `p2pk_frost` is the ordered array of aggregated
BIP-340 FROST signatures, one entry per proof in the encoded Provider Redemption
Token. A Provider redeems by signing the same proofs with its Provider key,
appending the corresponding group signature to each proof witness, and swapping
the signed proofs at the mint. The Provider does not need and must not receive a
FROST group private key.

`SIG_INPUTS` is required because peers can derive each mint-spendable message
from the token they verify. `SIG_ALL` would include the Provider's chosen swap
outputs, forcing peers to sign coordinator-selected output material and making
independent message derivation impractical for the threshold group.

Before a peer signer contributes a nonce or signature share for a token-bound
FROST P2PK release, it MUST:

- verify the submitted proof material against the request requirement;
- verify `sha256(utf8(encoded_token))` equals the token hash carried in the
  verified requirement;
- verify every token proof is a P2PK proof whose lock includes this peer's
  configured FROST group pubkey and `n_sigs=2`;
- accept only messages in the derived set `sha256(utf8(proof.secret))` for that
  token.

The coordinator MUST run a separate FROST signing session for each proof
message. Nonces from one proof message are never reused for another proof
message.

## Security Invariants

Security claims live in [`docs/threat-model.md`](../docs/threat-model.md), not
in this spec. This exchange depends on these invariants:

| Threat-model invariant | Exchange surface                                                                 |
| ---------------------- | -------------------------------------------------------------------------------- |
| `INV-01`               | Oracle proof verification rejects forged TLSNotary presentations before release. |
| `INV-02`               | Oracle wrappers do not expose preimages when verification fails.                 |
| `INV-03`               | Customer refund before Cashu locktime is rejected by the mint.                   |
| `INV-04`               | Stolen preimage alone cannot redeem a Provider-bound Payment Lock.               |

When a new security property is needed, add or update the threat-model invariant
and its tests before relying on it from this spec.
