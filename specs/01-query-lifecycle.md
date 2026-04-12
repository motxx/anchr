# Spec 01: Query Lifecycle

## Abstract

A query represents a request for verified data. This spec defines the query state machine, valid transitions, and expiry behavior.

## States

| State | Description |
|-------|-------------|
| `awaiting_quotes` | Query posted, waiting for Worker quotes |
| `processing` | Worker selected, proof production in progress |
| `verifying` | Proof submitted, Oracle verification in progress |
| `approved` | Verification passed, payment released (terminal) |
| `rejected` | Verification failed (terminal) |
| `expired` | Locktime reached without resolution (terminal) |

For simple (non-escrow) queries, an additional `pending` state exists with direct transitions to `approved`, `rejected`, or `expired`.

## State Transitions

### HTLC Queries (escrow-backed)

```
awaiting_quotes --> processing --> verifying --> approved
                        |              |
                        v              v
                     expired        rejected
                                      |
                                      v
                                   expired
```

| From | To | Trigger |
|------|----|---------|
| `awaiting_quotes` | `processing` | Requester selects a Worker |
| `awaiting_quotes` | `expired` | Locktime reached |
| `processing` | `verifying` | Worker submits proof |
| `processing` | `expired` | Locktime reached |
| `verifying` | `approved` | Oracle verification passes |
| `verifying` | `rejected` | Oracle verification fails |
| `verifying` | `expired` | Locktime reached |

### Simple Queries (no escrow)

| From | To | Trigger |
|------|----|---------|
| `pending` | `approved` | Verification passes |
| `pending` | `rejected` | Verification fails |
| `pending` | `expired` | TTL reached |

## Terminal States

`approved`, `rejected`, and `expired` are terminal. No further transitions are allowed.

## Cancellation

A query may be cancelled by the Requester in the following states: `pending`, `awaiting_quotes`, `worker_selected`, `processing`.

Cancellation triggers escrow refund if escrow was locked.

## Expiry

Queries carry an `expires_at` timestamp (derived from escrow locktime or a default TTL). When the current time exceeds `expires_at`, any non-terminal query transitions to `expired`.

For HTLC queries, expiry triggers automatic escrow refund to the Requester via the Cashu mint's locktime mechanism.

## Query Input

A Requester creates a query with:

| Field | Required | Description |
|-------|----------|-------------|
| `description` | yes | Human-readable description of what is needed |
| `verification_requirements` | no | Factors to verify: `tlsn`, `gps`, `nonce`, `timestamp`, `oracle`, `ai_check` |
| `tlsn_requirements` | conditional | Target URL, HTTP method, conditions (required when `tlsn` is in requirements) |
| `expected_gps` | no | Expected GPS coordinates for proximity check |
| `max_gps_distance_km` | no | Maximum allowed distance from expected GPS (default: 50) |
| `visibility` | conditional | `public` or `requester_only` (required when `tlsn_requirements` is set) |
| `bounty` | no | Payment amount in sats |
| `oracle_ids` | no | Acceptable Oracle IDs (default: built-in) |
| `quorum` | no | Multi-Oracle quorum config (see Spec 04) |
