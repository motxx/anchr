# Spec 05: Messaging

## Abstract

Anchr uses Nostr as its messaging transport, following the NIP-90 Data Vending Machine (DVM) pattern. This spec defines the event kinds, payloads, and lifecycle.

## Event Kinds

| Kind | Name | Direction | Purpose |
|------|------|-----------|---------|
| 5300 | Job Request | Requester → Relay | Post a query |
| 6300 | Job Result | Worker → Relay | Submit proof |
| 7000 | Job Feedback | Various | Quotes, selection, completion |

## Query Posting (kind 5300)

The Requester broadcasts a DVM Job Request:

```json
{
  "kind": 5300,
  "content": "<encrypted payload>",
  "tags": [
    ["i", "<target_url_or_description>", "text"],
    ["param", "oracle_ids", "<comma-separated>"],
    ["param", "quorum", "<min_approvals>"],
    ["bid", "<amount_sats>"]
  ]
}
```

### QueryRequestPayload

| Field | Description |
|-------|-------------|
| `description` | Human-readable query description |
| `verification_requirements` | Array of verification factors |
| `tlsn_requirements` | Target URL, method, conditions |
| `expected_gps` | GPS coordinates (for photo queries) |
| `max_gps_distance_km` | Max distance from expected GPS |
| `bounty` | `{ amount_sats }` |
| `oracle_ids` | Acceptable Oracle IDs |
| `quorum` | `{ min_approvals }` |
| `visibility` | `public` or `requester_only` |

## Worker Quote (kind 7000, status=payment-required)

A Worker discovers the query and submits a quote:

```json
{
  "kind": 7000,
  "content": "<optional message>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<requester_pubkey>"],
    ["status", "payment-required"],
    ["amount", "<requested_sats>", "sat"]
  ]
}
```

## Worker Selection (kind 7000, status=processing)

The Requester selects a Worker and announces:

```json
{
  "kind": 7000,
  "content": "<encrypted payload>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<worker_pubkey>"],
    ["status", "processing"]
  ]
}
```

### SelectionFeedbackPayload

The encrypted content includes:

| Field | Description |
|-------|-------------|
| `escrow_token` | Cashu token with spending conditions |
| `encrypted_context` | TLSNotary target URL, headers, etc. (encrypted to Worker) |

Sensitive context (session IDs, auth headers) is encrypted to the Worker and never stored publicly. The public query may include a `domain_hint` for display purposes.

## Proof Submission (kind 6300)

The Worker submits the result:

```json
{
  "kind": 6300,
  "content": "<encrypted payload>",
  "tags": [
    ["e", "<job_request_event_id>"],
    ["p", "<requester_pubkey>"],
    ["request", "<original_job_request_event>"]
  ]
}
```

### QueryResponsePayload

| Field | Description |
|-------|-------------|
| `attachments` | Blossom blob references |
| `notes` | Optional Worker notes |
| `gps` | GPS coordinates at submission time |
| `tlsn_attestation` | Base64-encoded `.presentation.tlsn` |
| `blossom_keys` | Map of attachment ID → AES-256-GCM key/IV (encrypted to Oracle + Requester) |

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

All sensitive payloads are encrypted using NIP-44 (versioned encryption). Point-to-point messages (e.g., preimage delivery, FROST shares) use NIP-44 direct messages between specific pubkeys.

## Transport Agnosticism

Nostr is the current transport. The protocol design permits alternative transports (HTTP-only mode, libp2p) by implementing the same message lifecycle over a different medium.
