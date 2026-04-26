# `@anchr/tlsn-toolkit` — Implementation Spec

> **Scope:** TLSNotary (MPC-TLS) verification at the application layer
> that this package owns. The Oracle interface itself is a host-side
> contract, summarised below for context. Other zkTLS providers
> (Reclaim, zkPass, …) would each be a sibling package; the protocol
> does not change.

## Oracle Interface (host-side context)

The host treats every verification provider through the same shape:

```
Oracle
  info: OracleInfo { id, name, endpoint?, fee_ppm }
  verify(query, result, blossomKeys?) → OracleAttestation
```

`OracleAttestation`:

| Field | Description |
|-------|-------------|
| `oracle_id` | Identifier of the attesting Oracle |
| `query_id` | Query being attested |
| `passed` | Whether verification succeeded |
| `checks` | List of checks that passed |
| `failures` | List of checks that failed |
| `attested_at` | Unix timestamp of attestation |
| `tlsn_verified` | Extracted TLSNotary data (when applicable — see *TlsnVerifiedData* below) |

This package implements the TLSNotary slice of `verify()`.

## Verification Factor: `tlsn`

A Requester opts into TLSNotary verification by including `"tlsn"` in
`verification_requirements`. The factor is **deterministic**: given the
same presentation and conditions, every honest Oracle reaches the same
verdict.

## How TLSNotary works

1. Worker initiates an MPC-TLS session with a TLSNotary Verifier.
2. Worker and Verifier jointly hold TLS key shares — neither sees the
   other's share.
3. Worker sends the HTTPS request to the target server through the
   co-signed TLS session.
4. Target server responds. Verifier co-signs without seeing plaintext.
5. Verifier produces a `.presentation.tlsn` file — a cryptographic proof
   that the specific server returned specific data.

## What this package adds on top

The Rust verifier crate gives raw cryptographic verification. This
package adds the application-layer hardening that real Oracle deployments
need:

1. **Cryptographic verification.** Validate signatures in the
   presentation; extract `server_name` (TLS certificate) and
   `revealed_body`.
2. **Server identity match.** `server_name` must match the
   `tlsn_requirements.target_url` domain.
3. **Condition evaluation** against `revealed_body`:

   | Condition Type | Description |
   |----------------|-------------|
   | `contains` | Body contains the expected string |
   | `regex` | Body matches the regex pattern |
   | `jsonpath` | JSONPath expression extracts expected value |

4. **ReDoS-safe condition language.** `regex` patterns are screened
   for nested quantifiers / catastrophic backtracking before they are
   compiled (`isSuspiciousRegex`).
5. **Attestation freshness** against `max_attestation_age_seconds`
   (default: 300 s).
6. **Replay protection.** SHA-256 dedup of accepted presentations.
7. **Credential leakage guard** — `validateNoCredentials()` blocks
   `Authorization`, `Cookie`, `X-API-Key`, etc., from being published.

## TlsnVerifiedData

On successful verification the Oracle produces:

| Field | Description |
|-------|-------------|
| `server_name` | Domain from TLS certificate |
| `revealed_body` | Response body from the proof |
| `revealed_headers` | Response headers (optional) |
| `session_timestamp` | Unix timestamp from the cryptographic proof |

## Proof Visibility

The host's `visibility` field controls whether the `.presentation.tlsn`
is published:

| Value | Behavior |
|-------|----------|
| `public` | Proof published to Nostr relays. Anyone can independently verify. |
| `requester_only` | Proof delivered only to the Requester via encrypted channel. |

`visibility` is required when `tlsn_requirements` is set — there is no
default. Before publishing, `validateNoCredentials()` redacts request
headers (`Authorization`, `Cookie`, `X-API-Key`) and blocks any leftover
authentication credentials.

Selective disclosure: only fields needed for condition evaluation are
revealed.

## zkTLS Agnosticism

The Oracle's `verify()` interface accepts any proof format that
demonstrates "server X returned data Y." TLSNotary is the only
implemented provider in this codebase.

| Provider | Technique | Status |
|----------|-----------|--------|
| TLSNotary | MPC-TLS (Verifier holds independent key share) | Implemented (this package) |
| Reclaim Protocol | HTTPS proxy + ZK proofs | No adapter yet |
| zkPass | TEE + ZK circuits | No adapter yet |
| Opacity Network | MPC-TLS (alternative implementation) | No adapter yet |

Adding a new provider means writing a sibling package that exposes the
same `verify()` shape. The protocol does not change.

## Test References

- Unit: `packages/tlsn-toolkit/src/tlsn-validation.test.ts` (mock
  verifier binary; runs without the Rust crate built).
- E2E: `e2e/tlsn.test.ts`, `e2e/tlsn-browser.test.ts` (real verifier
  binary + browser-extension prover).
- Threat-model invariant `INV-01` (see `docs/threat-model.md`).
- Companion Rust crates: `crates/tlsn-verifier/`, `crates/tlsn-prover/`,
  `crates/tlsn-server/`.
