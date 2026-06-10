# Nostr DVM Messaging

## Abstract

Anchr uses Nostr as its messaging transport, following the NIP-90 Data Vending
Machine (DVM) pattern. This spec defines the event kinds, payloads, and
lifecycle encoding for Customer, Provider, and Oracle actors.

The v0 paid-request exchange, Cashu Payment Lock, and redeem/refund rules are
defined in [`paid-request-exchange.md`](paid-request-exchange.md). This document
specifies their Nostr event encoding.

Proof format dispatch uses HTTPS schema URLs defined in
[`proof-schemas.md`](proof-schemas.md). Public Nostr query events carry the
schema URL in an `s` tag and a public advertisement body for discovery.
Encrypted Provider Selection payloads carry the same URL in their `schema` field
plus execution details for the selected Provider.

## Actor Naming

The protocol actors are defined in
[`paid-request-exchange.md#actors`](paid-request-exchange.md#actors). This Nostr
encoding maps them to event authors and `p` tags. Pre-1.0 payloads use direct
Customer/Provider field names rather than compatibility aliases.

## Canonical Implementation Owners

`@anchr/protocol/events` is the canonical Nostr wire helper surface for kind
`5300`, `6300`, `7000`, and Oracle-to-Provider release DMs. Compatible
implementations should match the event shapes documented here.

`@anchr/sdk/adapters/nostr` owns SDK relay transport, subscriptions, actor
service wiring, Oracle announcement publishing, and adapter-private encryption
helpers. It may contain internal builders used by the SDK services, but it is
not a second public wire contract for query, result, feedback, or release
messages.

| Message class               | Canonical owner             | SDK adapter responsibility                                        |
| --------------------------- | --------------------------- | ----------------------------------------------------------------- |
| Job request `5300`          | `@anchr/protocol/events`    | Relay discovery and service orchestration                         |
| Job result `6300`           | `@anchr/protocol/events`    | Publishing/subscription flow and attachment transport composition |
| Job feedback `7000`         | `@anchr/protocol/events`    | Offer and selection service flow                                  |
| Release DM kind `4`         | `@anchr/protocol/events`    | Waiting for Oracle settlement messages                            |
| Oracle announcement `30088` | `@anchr/sdk/adapters/nostr` | Oracle registry publication and relay E2E coverage                |

## Event Kinds

| Kind | Name         | Direction         | Purpose                       |
| ---- | ------------ | ----------------- | ----------------------------- |
| 5300 | Job Request  | Customer -> Relay | Post a query                  |
| 6300 | Job Result   | Provider -> Relay | Submit proof                  |
| 7000 | Job Feedback | Various           | Offers, selection, completion |

## Query Posting (kind 5300)

The Customer broadcasts a DVM Job Request as a public request advertisement:

```json
{
  "kind": 5300,
  "content": "{\"query_id\":\"query_123\", ...}",
  "tags": [
    ["d", "<query_id>"],
    ["t", "anchr"],
    ["p", "<oracle_pubkey>", "", "oracle"],
    ["s", "https://anchr-spec.org/spec/proof/tlsn/v1"]
  ]
}
```

The request content is signed JSON, not encrypted NIP-44 content. Its content is
an explicit public allowlist for open Provider discovery. Sensitive execution
context and payment-bearing material must travel in later Provider Selection
messages or attachments rather than the public request body. The canonical
helper does not use a NIP-90 `bid` tag for payment material.

### QueryRequestPayload

| Field             | Description                                      |
| ----------------- | ------------------------------------------------ |
| `query_id`        | Caller-chosen query id; SHOULD match the `d` tag |
| `schema`          | Proof schema URL                                 |
| `customer_pubkey` | Customer Nostr pubkey                            |
| `oracle_pubkey`   | Oracle Nostr pubkey                              |
| `max_amount_sats` | Maximum Customer payment in sats                 |
| `expires_at`      | Offer cutoff as Unix milliseconds                |

The public content MUST NOT include `predicate`, `context`, `mint_url`,
`payment_lock`, `payment_lock_token`, `bounty_token`,
`provider_redemption_token`, or `locktime_seconds`. The canonical parser
rejects an advertisement carrying any of these field names.

## Provider Offer (kind 7000, status=payment-required)

A Provider discovers the query and submits an offer:

```json
{
  "kind": 7000,
  "content": "{\"status\":\"payment-required\", ...}",
  "tags": [
    ["e", "<job_request_event_id>", "", "request"],
    ["p", "<customer_pubkey>"],
    ["status", "payment-required"]
  ]
}
```

The offer content is signed JSON with `status`, `provider_pubkey`, and
`amount_sats`. The `provider_pubkey` must match the event author.

## Provider Selection (kind 7000, status=processing)

The Customer selects a Provider and publishes a routing-visible selection event:

```json
{
  "kind": 7000,
  "content": "<encrypted Provider-only payload>",
  "tags": [
    ["e", "<job_request_event_id>", "", "request"],
    ["p", "<provider_pubkey>"],
    ["status", "processing"]
  ]
}
```

### SelectionFeedbackPayload

The encrypted content includes:

| Field                       | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `selected_provider_pubkey`  | Selected Provider Nostr pubkey                          |
| `provider_redemption_token` | Token the selected Provider redeems after valid release |
| `execution`                 | Provider-only execution payload and payment-lock terms  |

The `execution` object includes:

| Field              | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `schema`           | Proof schema URL                                           |
| `predicate`        | Schema-specific predicate interpreted by the proof profile |
| `description`      | Optional human-readable request detail                     |
| `context`          | Optional schema-agnostic context                           |
| `mint_url`         | Cashu mint URL for the v0 Payment Lock                     |
| `max_amount_sats`  | Maximum Customer payment in sats                           |
| `locktime_seconds` | Cashu refund locktime as Unix seconds                      |

Sensitive context (session IDs, auth headers) is encrypted to the Provider and
never stored publicly.

## Provider Work Gate

Before irreversible work, the Provider verifies that the selected Cashu payment
material corresponds to the request, the selected Provider pubkey, the expected
Oracle, and the Cashu lock conditions. Any local preflight record is
implementation state, not Nostr wire data.

## Proof Submission (kind 6300)

The Provider submits the result:

```json
{
  "kind": 6300,
  "content": "<encrypted payload>",
  "tags": [
    ["e", "<job_request_event_id>", "", "request"],
    ["p", "<customer_pubkey>"],
    ["p", "<oracle_pubkey>", "", "oracle"],
    ["oracle_payload", "<encrypted Oracle-readable payload>"]
  ]
}
```

### QueryResponsePayload

| Field    | Description                                                        |
| -------- | ------------------------------------------------------------------ |
| `schema` | Proof schema URL used to dispatch Oracle and Customer verification |
| `data`   | Verified response payload, shaped by the schema                    |
| `proof`  | Proof bytes encoded by the schema, usually base64 or hex           |

When an Oracle pubkey is provided, the result also carries an `oracle_payload`
tag encrypted to the Oracle. The Oracle-readable payload adds `query_id` and
`request_event_id` to the same `schema`, `data`, and `proof` fields so the
Oracle can verify without an Anchr-operated result server.

## Completion Feedback Boundary

Kind `7000` status `success` and `error` completion feedback is explicitly
excluded from the stable Anchr v0 Nostr profile. Implementations may emit or
consume completion events as SDK-local or adapter-local policy, but compatible
Anchr actors must not require them for offer selection, proof submission, Oracle
verification, release delivery, or Cashu redemption.

If a future version promotes completion feedback into the interoperable profile,
that version must define payload fields, causal tags, parser behavior, and tests
in `@anchr/protocol/events`.

Example SDK-local draft shape:

```json
{
  "kind": 7000,
  "tags": [
    ["e", "<job_request_event_id>"],
    ["status", "success"],
    ["amount", "<paid_sats>", "sat"]
  ]
}
```

## Encryption

All sensitive payloads are encrypted using NIP-44 (versioned encryption). Kind
`6300` result content, `oracle_payload` tags, and kind `7000` selection content
are NIP-44 encrypted to their recipients. Kind `5300` request content and kind
`7000` offer content are signed JSON; they must not contain private session
headers, bearer credentials, proof predicates, proof secrets, Provider
Redemption Tokens, or spendable release material. Point-to-point messages such
as preimage delivery use NIP-44 direct messages between specific pubkeys.

## Release Material and Redeem Gate

Oracle release material follows
[`paid-request-exchange.md#release-and-redeem`](paid-request-exchange.md#release-and-redeem).
For the stable v0 Nostr profile, release delivery is an Oracle-to-Provider
NIP-44 DM (kind `4`) carrying HTLC preimage material. The canonical release
payload binds:

| Field              | Description                                       |
| ------------------ | ------------------------------------------------- |
| `query_id`         | Query identifier from the Customer request        |
| `request_event_id` | Original kind 5300 event id                       |
| `preimage`         | Cashu HTLC preimage for the selected Payment Lock |

Correlation mismatches are audit inputs, not redeem hard failures by themselves;
the redeem decision remains the rule in
[`paid-request-exchange.md#release-and-redeem`](paid-request-exchange.md#release-and-redeem).

FROST group-signature delivery remains SDK-local release policy in v0. The SDK
adapter currently uses encrypted kind `4` DMs with a `frost_signature` payload
for P2PK+FROST flows, and tests that adapter behavior under
`packages/sdk/src/adapters/nostr/events/frost-dm.test.ts` and
`packages/sdk/src/adapters/nostr/oracle-frost.test.ts`. Those messages are not
part of the stable `@anchr/protocol/events` helper surface and are not required
for compatible paid-request implementations.

## Release Delivery Reliability

The release material is the most critical message in the Nostr profile. If the
Provider completed valid work but never receives the preimage or FROST
signature, they cannot redeem escrow. The Nostr delivery strategy is:

### NIP-44 Delivery

1. **Primary**: Oracle sends release material via NIP-44 DM to the Provider,
   published to configured relays.

2. **Retry**: Confirmed retry-store semantics are SDK-local policy in v0.
   Implementations may retry on relay publish failure and may retain release
   material for later delivery, but the stable Nostr profile does not define a
   retry request event kind, retry success criterion, or interoperable retry
   store.

3. **Recovery**: If direct relay delivery keeps failing, the Provider may send
   an authenticated Nostr retry request that references the original kind 5300
   request, selected offer, and proof submission. The Oracle answers with a new
   NIP-44 DM to the selected Provider pubkey. Implementations may choose their
   own retry event kind or tag set unless a future profile standardizes one, but
   the recovery path remains Nostr-native and is not a hosted Anchr HTTP
   endpoint.

### Provider-Side Behavior

The Provider subscribes to NIP-44 DMs from the Oracle. If no release material
arrives within a configurable timeout (e.g., 30 seconds after proof submission),
the Provider may publish an authenticated retry request on the configured
relays.

### Deletion Policy

The public Nostr contract does not specify Oracle retry-store deletion rules.
Implementations must not represent a stricter retention guarantee as
interoperable behavior unless a future profile standardizes and tests it.

## Transport Scope

Nostr is the Anchr protocol transport for this repository. Compatible
implementations use the Nostr event kinds, tags, payloads, signing rules, and
NIP-44 encryption boundaries defined in this spec.
