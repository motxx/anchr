# Nostr DVM Messaging

## Abstract

Anchr uses Nostr as its messaging transport, following the NIP-90 Data Vending
Machine (DVM) pattern. This spec defines the event kinds, payloads, and
lifecycle for Customer, Provider, and Oracle actors.

The role-neutral lifecycle, state transitions, preflight ticket, and redeem
rules are defined in [`protocol-contract.md`](protocol-contract.md). This
document specifies their Nostr event encoding.

Proof format dispatch uses HTTPS schema URLs defined in
[`proof-schemas.md`](proof-schemas.md). Public Nostr query events carry the
schema URL in an `s` tag for discovery, and encrypted payloads carry the same
URL in their `schema` field for execution.

## Actor Naming

The protocol actors are defined in
[`protocol-contract.md#actors`](protocol-contract.md#actors). This Nostr profile
maps them to event authors and `p` tags. Some current field names still use
`requester_*` or `worker_*`; those are compatibility identifiers for existing
events and host-shaped code. New prose and SDK APIs use Customer and Provider.
Once versioned replacements are available, requester/worker names should be
removed rather than retained as aliases.

## Event Kinds

| Kind | Name         | Direction         | Purpose                       |
| ---- | ------------ | ----------------- | ----------------------------- |
| 5300 | Job Request  | Customer -> Relay | Post a query                  |
| 6300 | Job Result   | Provider -> Relay | Submit proof                  |
| 7000 | Job Feedback | Various           | Offers, selection, completion |

## Query Posting (kind 5300)

The Customer broadcasts a DVM Job Request:

```json
{
  "kind": 5300,
  "content": "<encrypted payload>",
  "tags": [
    ["i", "<target_url_or_description>", "text"],
    ["s", "https://anchr-spec.org/spec/proof/tlsn/v1"],
    ["param", "oracle_ids", "<comma-separated>"],
    ["param", "quorum", "<min_approvals>"],
    ["bid", "<amount_sats>"]
  ]
}
```

### QueryRequestPayload

| Field                       | Description                         |
| --------------------------- | ----------------------------------- |
| `description`               | Human-readable query description    |
| `schema`                    | Proof schema URL                    |
| `verification_requirements` | Array of verification factors       |
| `tlsn_requirements`         | Target URL, method, conditions      |
| `expected_gps`              | GPS coordinates (for photo queries) |
| `max_gps_distance_km`       | Max distance from expected GPS      |
| `bounty`                    | `{ amount_sats }`                   |
| `oracle_ids`                | Acceptable Oracle IDs               |
| `quorum`                    | `{ min_approvals }`                 |
| `visibility`                | `public` or `requester_only`        |

## Provider Offer (kind 7000, status=payment-required)

A Provider discovers the query and submits an offer:

```json
{
  "kind": 7000,
  "content": "<optional message>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<customer_pubkey>"],
    ["status", "payment-required"],
    ["amount", "<requested_sats>", "sat"]
  ]
}
```

## Provider Selection (kind 7000, status=processing)

The Customer selects a Provider and announces:

```json
{
  "kind": 7000,
  "content": "<encrypted payload>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<provider_pubkey>"],
    ["status", "processing"]
  ]
}
```

### SelectionFeedbackPayload

The encrypted content includes:

| Field               | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `escrow_token`      | Cashu token with spending conditions                        |
| `encrypted_context` | TLSNotary target URL, headers, etc. (encrypted to Provider) |

Sensitive context (session IDs, auth headers) is encrypted to the Provider and
never stored publicly. The public query may include a `domain_hint` for display
purposes.

## Provider Preflight

Before irreversible work, the Provider verifies the selected escrow and records
the immutable preflight ticket required by
[`protocol-contract.md#provider-preflight`](protocol-contract.md#provider-preflight).
For this Nostr profile, the original request reference is the kind 5300 event
id, the expected authority is the Oracle pubkey or FROST group key referenced by
the encrypted request and selection payloads, and the selected offer reference
is the kind 7000 `status=payment-required` event id when available.

## Proof Submission (kind 6300)

The Provider submits the result:

```json
{
  "kind": 6300,
  "content": "<encrypted payload>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<customer_pubkey>"],
    ["request", "<original_job_request_event>"]
  ]
}
```

### QueryResponsePayload

| Field              | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `schema`           | Proof schema URL used to dispatch Oracle and Customer verification          |
| `attachments`      | Blossom blob references                                                     |
| `notes`            | Optional Provider notes                                                     |
| `gps`              | GPS coordinates at submission time                                          |
| `tlsn_attestation` | Base64-encoded `.presentation.tlsn`                                         |
| `blossom_keys`     | Map of attachment ID -> AES-256-GCM key/IV (encrypted to Oracle + Customer) |

## Completion (kind 7000, status=success or error)

After Oracle verification:

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

All sensitive payloads are encrypted using NIP-44 (versioned encryption).
Point-to-point messages (e.g., preimage delivery, FROST shares) use NIP-44
direct messages between specific pubkeys.

## Release Material and Redeem Gate

Oracle release material follows
[`protocol-contract.md#release-and-redeem`](protocol-contract.md#release-and-redeem).
For this Nostr profile, a release message binds:

| Field                 | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `query_id`            | Query identifier from the Customer request                   |
| `request_event_id`    | Original kind 5300 event id                                  |
| `payment_hash`        | Hash committed in the selected bound token                   |
| `provider_pubkey`     | Provider pubkey the token is bound to                        |
| `oracle_pubkey`       | Releasing Oracle pubkey, for single-Oracle releases          |
| `oracle_group_pubkey` | Expected FROST group key, for threshold releases             |
| `preimage`            | HTLC preimage, when the payment profile uses NUT-14 hashlock |
| `signature`           | Oracle or FROST signature over the release fields            |

Correlation mismatches are audit inputs, not redeem hard failures by themselves;
the redeem decision remains the universal rule in
[`protocol-contract.md#release-and-redeem`](protocol-contract.md#release-and-redeem).

## Release Delivery Reliability

The release material is the most critical message in the Nostr profile. If the
Provider completed valid work but never receives the preimage or FROST
signature, they cannot redeem escrow. The Nostr delivery strategy is:

### NIP-44 Delivery

1. **Primary**: Oracle sends release material via NIP-44 DM to the Provider,
   published to multiple relays. The message MUST succeed on at least one relay
   before the release material is deleted from the Oracle's retry store.

2. **Retry**: If zero relays confirm, retry with exponential backoff (3
   attempts: 2s, 4s, 8s). The Oracle MUST NOT delete release material until at
   least one relay delivery is confirmed or a later redeem observation proves
   the Provider received spendable material.

3. **Recovery**: If direct relay delivery keeps failing, the Provider may send
   an authenticated Nostr retry request that references the original kind 5300
   request, selected offer, and proof submission. The Oracle answers with a new
   NIP-44 DM to the selected Provider pubkey. Implementations may choose their
   own retry event kind or tag set until a dedicated profile is standardized,
   but the recovery path remains Nostr-native and is not a hosted Anchr HTTP
   endpoint.

### Provider-Side Behavior

The Provider subscribes to NIP-44 DMs from the Oracle. If no release material
arrives within a configurable timeout (e.g., 30 seconds after proof submission),
the Provider may publish an authenticated retry request on the configured
relays.

### Deletion Policy

The Oracle MUST retain release material until at least one of the following is
confirmed:

- Relay delivery success (at least 1 relay acknowledged)
- Authenticated Nostr retry delivery to the selected Provider
- Escrow redemption observed on the Cashu mint

## Transport Agnosticism

Nostr is the current protocol transport. The protocol design permits alternative
transports by implementing the same message lifecycle over a different medium,
but Anchr does not define a default hosted HTTP relay or reference-host
endpoint.
