# Spec 03: Verification

## Abstract

Oracles verify proofs submitted by Workers. This spec defines the Oracle interface, verification modes (TLSNotary, C2PA), and proof visibility.

## Oracle Interface

```
Oracle
  info: OracleInfo { id, name, endpoint?, fee_ppm }
  verify(query, result, blossomKeys?) → OracleAttestation
```

`OracleAttestation` contains:

| Field | Description |
|-------|-------------|
| `oracle_id` | Identifier of the attesting Oracle |
| `query_id` | Query being attested |
| `passed` | Whether verification succeeded |
| `checks` | List of checks that passed |
| `failures` | List of checks that failed |
| `attested_at` | Unix timestamp of attestation |
| `tlsn_verified` | Extracted TLSNotary data (if applicable) |

## Verification Factors

A Requester specifies which factors to verify:

| Factor | Description |
|--------|-------------|
| `tlsn` | TLSNotary web proof |
| `gps` | GPS proximity check |
| `nonce` | Challenge nonce visible in photo |
| `timestamp` | Timestamp freshness |
| `oracle` | Oracle-level attestation |
| `ai_check` | AI-based content analysis |

Default: `["gps", "ai_check"]` (for photo queries).

## Web Verification: TLSNotary (MPC-TLS)

### How It Works

1. Worker initiates an MPC-TLS session with a TLSNotary Verifier.
2. Worker and Verifier jointly hold TLS key shares — neither sees the other's share.
3. Worker sends HTTPS request to the target server through the co-signed TLS session.
4. Target server responds. Verifier co-signs without seeing plaintext.
5. Verifier produces a `.presentation.tlsn` file — a cryptographic proof that the specific server returned specific data.

### Oracle Verification

The Oracle independently verifies the presentation:

1. Validate cryptographic signatures in the presentation.
2. Extract `server_name` (from TLS certificate) and `revealed_body`.
3. Check `server_name` matches `tlsn_requirements.target_url` domain.
4. Evaluate conditions against `revealed_body`:

| Condition Type | Description |
|----------------|-------------|
| `contains` | Body contains the expected string |
| `regex` | Body matches the regex pattern |
| `jsonpath` | JSONPath expression extracts expected value |

5. Check attestation freshness against `max_attestation_age_seconds` (default: 300s).

### TlsnVerifiedData

On successful verification, the Oracle produces:

| Field | Description |
|-------|-------------|
| `server_name` | Domain from TLS certificate |
| `revealed_body` | Response body from the proof |
| `revealed_headers` | Response headers (optional) |
| `session_timestamp` | Unix timestamp from the cryptographic proof |

## Photo Verification: C2PA + GPS

### How It Works

1. Worker photographs the target with a C2PA-signed camera.
2. C2PA Content Credentials are cryptographically bound to the image, GPS coordinates, and timestamp.
3. Worker strips EXIF metadata (privacy), but C2PA manifest is preserved.
4. Oracle verifies C2PA signature chain, GPS proximity, and optional challenge nonce.

### GPS Proximity Check

The Requester specifies `expected_gps` and `max_gps_distance_km`. The Oracle computes the Haversine distance between the photo's GPS coordinates and the expected location.

## Proof Visibility

The `visibility` field controls whether TLSNotary proofs are published:

| Value | Behavior |
|-------|----------|
| `public` | Proof is published to Nostr relays. Anyone can independently verify. |
| `requester_only` | Proof is delivered only to the Requester via encrypted channel. |

`visibility` is required when `tlsn_requirements` is set. There is no default — the Requester must explicitly choose.

### Safety Checks for Public Proofs

Before publishing, the following are enforced:

- Request headers containing `Authorization`, `Cookie`, `X-API-Key` are redacted.
- Only fields needed for condition evaluation are disclosed (selective disclosure).
- A pre-publish validation blocks any detected authentication credentials.

## zkTLS Agnosticism

TLSNotary is the current implementation. The protocol supports any zkTLS provider that produces a proof of "server X returned data Y":

| Provider | Technique |
|----------|-----------|
| TLSNotary | MPC-TLS (Verifier holds independent key share) |
| Reclaim Protocol | HTTPS proxy + ZK proofs |
| zkPass | TEE + ZK circuits |
| Opacity Network | MPC-TLS (alternative implementation) |

Adding a new provider means implementing a verifier adapter for the `verify()` interface.
