# HTTP 402 Payment Integrations

This note records the current placement decision for HTTP 402-style payment
integrations such as x402 and L402. It is an adapter design note, not a
universal protocol contract.

## External Protocols

x402 is an HTTP-native payment negotiation flow. A resource server can return
`402 Payment Required` with payment requirements, the client retries with a
signed payment payload, and the server verifies locally or through a facilitator
before returning the paid resource. The current x402 foundation implementation
describes resource servers, clients, optional facilitators, schemes, and
networks as HTTP payment infrastructure rather than as proof-verification
actors:

- <https://github.com/x402-foundation/x402>
- <https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works>

L402 is a Lightning payment authentication scheme. A service issues a Macaroon
bound to a Lightning invoice payment hash, and the client later presents the
Macaroon with the invoice preimage as proof of payment. The credential is
transmitted at the HTTP or gRPC layer and relies on TLS or an equivalent secure
channel because the Macaroon and preimage are presented to the service:

- <https://docs.lightning.engineering/the-lightning-network/l402/l402>
- <https://docs.lightning.engineering/the-lightning-network/l402/protocol-specification>

Recent x402 security research highlights that 402 integrations add payment
metadata, replay, binding, and paid-but-denied failure surfaces that are
separate from Anchr's current Cashu HTLC and Oracle release gates:

- <https://arxiv.org/abs/2605.11781>
- <https://arxiv.org/abs/2604.11430>

## Fit With Anchr

Anchr's protocol lifecycle is:

```text
request -> provider_offer -> selection -> provider_preflight -> work
  -> proof_submission -> oracle_verification -> release -> redeem_or_refund
```

HTTP 402 protocols solve a different problem: synchronous access control and
payment for an HTTP resource. They can be useful around Anchr, but they do not
replace the request, selection, proof, Oracle release, or settlement-lock
contracts. Treating a 402 payment as an Anchr settlement lock would weaken the
current invariant that the Provider redeems only after Oracle-approved proof.

The useful integration points are therefore adapter-owned:

| Candidate | Placement | Preserves Anchr invariants? | Notes |
| --- | --- | --- | --- |
| Paid app-owned HTTP route that creates or reads Anchr requests | `apps/<app>/` or an app adapter | Yes, if the paid route only gates access to the app API | Good first target because it does not change Customer, Provider, Oracle, or Cashu HTLC semantics. |
| Paid MCP tool invocation for agents | `apps/anchr-mcp/` | Yes, if the MCP adapter charges for tool access before calling SDK use cases | Useful for agent demos, but should stay adapter-local. |
| Paid Oracle verification endpoint | Oracle adapter or example | Risky unless the Oracle still releases material only after proof success | Requires explicit denial-mode handling so payment failure cannot suppress a valid release after work is complete. |
| Provider API monetization outside the Anchr escrow | Provider-owned app route | Yes, when it charges for discovery, previews, or non-settlement services | Must not be represented as the Provider's Anchr redeem path. |
| SDK helper for calling paid HTTP resources | Maybe `@anchr/sdk` only after examples prove repeatability | Usually yes, but premature as a core SDK dependency | Needs a chain/provider-neutral port, not a hard dependency on a specific x402 or L402 implementation. |
| Universal Anchr transport or settlement profile | `specs/` | No current need | Would require new wire rules, threat-model entries, and tests before promotion. |

## Recommendation

The first implementation should be an example-level paid HTTP adapter, not a
protocol profile or SDK default. The narrowest useful target is a demo route
that charges with x402 or L402 before letting a caller create, inspect, or call
an Anchr-backed app endpoint. That keeps the payment-for-access concern outside
the Customer/Provider/Oracle lifecycle while still showing how agent-facing HTTP
payments compose with Anchr.

The initial adapter must observe these constraints:

- It must not replace Cashu HTLC escrow, Provider preflight, Oracle proof
  verification, release binding, or redeem/refund semantics.
- It must not make a facilitator, Lightning node, HTTP gateway, or paid API
  service a fourth Anchr protocol actor.
- It must not send private proof data, personal metadata, source ecash proofs,
  Nostr secret keys, or Oracle release material in 402 payment metadata.
- It must bind paid HTTP access to the app route being served, not to an Anchr
  proof verdict or settlement release.
- It must document whether payment is settled before work, after a successful
  response, or through a deferred settlement path.
- It must include replay and duplicate-payment handling at the adapter boundary.

## Harness Route

This is a boundary-placement decision. The repository already has the right
harness owners:

- `docs/universality-boundaries.md` keeps 402 support in the adapter or example
  class unless a future issue promotes an interoperability profile.
- `docs/review-harness.md` routes future repeated failures to example smoke
  tests, adapter docs, threat-model entries, or a protocol spec change.
- Any implementation that charges for Oracle verification, settlement, release,
  redemption, signing, or authorization must run the silent-bypass review skill
  before closure.

Follow-up implementation should start with a closeable example issue rather
than a broad SDK or protocol issue.
