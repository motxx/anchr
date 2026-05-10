# Nostr DVM Messaging

## Abstract

Anchr uses Nostr as its messaging transport, following the NIP-90 Data Vending
Machine (DVM) pattern. This spec defines the event kinds, payloads, and
lifecycle for Customer, Provider, and Oracle actors.

Proof format dispatch uses HTTPS schema URLs defined in
[`proof-schemas.md`](proof-schemas.md). Public Nostr query events carry the
schema URL in an `s` tag for discovery, and encrypted payloads carry the same
URL in their `schema` field for execution.

## Actors

- **Customer** posts a query, selects a Provider, and locks payment.
- **Provider** quotes work, submits proof, and redeems after Oracle approval.
- **Oracle** verifies proof material and releases the unlock material.

Some current field names still use `requester_*` or `worker_*`. Those names are
compatibility identifiers for existing events and host-shaped code; new prose
and SDK APIs use Customer and Provider. Once versioned replacements are
available, requester/worker names should be removed rather than retained as
aliases.

## Event Kinds

| Kind | Name         | Direction         | Purpose                       |
| ---- | ------------ | ----------------- | ----------------------------- |
| 5300 | Job Request  | Customer -> Relay | Post a query                  |
| 6300 | Job Result   | Provider -> Relay | Submit proof                  |
| 7000 | Job Feedback | Various           | Quotes, selection, completion |

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

## Provider Quote (kind 7000, status=payment-required)

A Provider discovers the query and submits a quote:

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
an immutable preflight ticket. The preflight report is structured:

| Field      | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| `ok`       | Whether the Provider may start work                                |
| `errors`   | Hard failures that prevent `produce()`                             |
| `warnings` | Non-fatal risks to record before proceeding                        |
| `details`  | Parsed escrow facts used to build the ticket and explain decisions |

The ticket binds the work decision to concrete escrow facts: `query_id`,
original request event id, expected Oracle pubkey or FROST group key, Provider
pubkey, mint URL, payment hash, token fingerprint, accepted amount, quote
amount, locktime, and Provider policy version. If the ticket cannot be created,
the Provider declines selection and does not call `produce()`.

Provider policy is closed at preflight. After the Provider starts work, later
policy changes can affect future quotes and audit outcomes, but they must not
block redeem of the accepted token.

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

Oracle release material is not just a bare preimage. A release message binds:

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

Provider-side settlement has three separate decisions:

- Mint-level redeem checks token spendability: matching preimage, Provider
  pubkey lock, Provider signature, and mint acceptance.
- Clean settlement checks expected authority and release signature binding.
- Audit / reputation records mismatched source, signature, `query_id`,
  `request_event_id`, reply thread, or other correlation anomalies.

Correlation mismatches are not redeem hard failures by themselves. If release
material is not a clean valid release but still unlocks the Provider's current
bound token, the Provider should attempt economic redeem and record the anomaly.
If the preimage does not match the token hashlock, the token is not locked to
the Provider, or the Provider cannot sign, redeem fails.

Oracle release is driven by proof validity and the expected release authority. A
host, coordinator, or Customer cancel observed after proof verification must not
suppress release material for valid completed work.

## Preimage Delivery Reliability

The preimage is the most critical message in the protocol. If the Provider
completed valid work but never receives the preimage, they cannot redeem escrow.
The following delivery strategy MUST be implemented:

### Three-Tier Delivery

1. **Primary**: Oracle sends preimage via NIP-44 DM to the Provider, published
   to multiple relays. The message MUST succeed on at least one relay before the
   preimage is deleted from the Oracle's store.

2. **Retry**: If zero relays confirm, retry with exponential backoff (3
   attempts: 2s, 4s, 8s). The Oracle MUST NOT delete the preimage until at least
   one delivery is confirmed.

3. **Fallback (HTTP)**: The Oracle MAY expose an HTTP endpoint
   (`GET /oracle/preimage/:queryId`) where the Provider can poll for the
   preimage. The endpoint MUST authenticate the request by verifying the caller
   is the selected Provider (e.g., Nostr signature). The preimage is served only
   if the query is approved. This fallback is an Oracle-operated adapter
   endpoint, not a hosted Anchr reference endpoint.

### Provider-Side Behavior

The Provider subscribes to NIP-44 DMs from the Oracle. If no preimage arrives
within a configurable timeout (e.g., 30 seconds after proof submission), the
Provider SHOULD poll the Oracle's HTTP fallback endpoint when that endpoint is
announced.

### Deletion Policy

The Oracle MUST retain the preimage until at least one of the following is
confirmed:

- Relay delivery success (at least 1 relay acknowledged)
- HTTP fetch by the Provider
- Escrow redemption observed on the Cashu mint

## Transport Agnosticism

Nostr is the current protocol transport. The protocol design permits alternative
transports by implementing the same message lifecycle over a different medium,
but Anchr does not define a default hosted HTTP relay or reference-host
endpoint.
