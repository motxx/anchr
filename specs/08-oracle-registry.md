# Spec 08: Oracle Registry

## Abstract

Oracles announce their capabilities, fees, and endpoints via Nostr. Requesters discover available Oracles by querying relays. This spec defines the announcement event format and discovery protocol.

## Motivation

Spec 00 defines Oracle IDs as an input to query creation, but does not specify how a Requester discovers which Oracles exist, what they can verify, or how much they charge. Without a discovery mechanism, the protocol is closed to new Oracle operators.

## Oracle Announcement Event

Oracles publish a Nostr parametrized replaceable event (NIP-78 style):

| Field | Value |
|-------|-------|
| `kind` | `30088` |
| `d` tag | Oracle ID (unique identifier) |
| `t` tags | `anchr-oracle`, plus capability tags |
| `content` | JSON-encoded `OracleAnnouncement` |

### Tags

```json
{
  "kind": 30088,
  "tags": [
    ["d", "my-oracle-id"],
    ["t", "anchr-oracle"],
    ["t", "anchr-oracle-tlsn"],
    ["t", "anchr-oracle-c2pa"],
    ["t", "anchr-oracle-gps"]
  ],
  "content": "{ ... }"
}
```

Capability tags follow the pattern `anchr-oracle-<factor>` where `<factor>` is a verification factor from Spec 03 (`tlsn`, `gps`, `nonce`, `timestamp`, `oracle`, `ai_check`, `c2pa`).

### OracleAnnouncement

The `content` field contains a JSON object:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Human-readable Oracle name |
| `endpoint` | no | HTTP API URL for external Oracles |
| `fee_ppm` | yes | Fee in parts-per-million of bounty (e.g., 50000 = 5%) |
| `supported_factors` | yes | Array of verification factors this Oracle supports |
| `supported_escrow_types` | yes | Array of escrow types: `htlc`, `p2pk_frost` |
| `min_bounty_sats` | no | Minimum bounty this Oracle accepts |
| `max_bounty_sats` | no | Maximum bounty this Oracle accepts |
| `description` | no | Free-text description of the Oracle service |

### Example

```json
{
  "name": "Anchr Default Oracle",
  "fee_ppm": 50000,
  "supported_factors": ["tlsn", "gps", "c2pa", "nonce", "timestamp"],
  "supported_escrow_types": ["htlc", "p2pk_frost"],
  "min_bounty_sats": 1,
  "max_bounty_sats": 1000000,
  "description": "Built-in Anchr Oracle with TLSNotary and C2PA verification"
}
```

## Discovery

Requesters discover Oracles by querying Nostr relays:

```json
{
  "kinds": [30088],
  "#t": ["anchr-oracle"]
}
```

To filter by capability (e.g., only TLSNotary-capable Oracles):

```json
{
  "kinds": [30088],
  "#t": ["anchr-oracle-tlsn"]
}
```

## Liveness

Oracles SHOULD republish their announcement at a regular interval (e.g., hourly). Clients MAY filter by `since` to discover only recently active Oracles.

A parametrized replaceable event (kind 30088 with `d` tag) replaces the previous announcement for the same Oracle ID, keeping relay storage bounded.

## Trust Model

The announcement is self-reported. It tells you what an Oracle *claims* to support, not what it *actually* supports. The cryptographic verification in Specs 03-04 is what enforces correctness — the registry is a convenience for discovery, not a trust mechanism.

Requesters SHOULD:
- Verify Oracle pubkeys against a trusted whitelist for high-value queries.
- Start with the built-in Oracle and add third-party Oracles incrementally.
- Use threshold Oracle (Spec 04) to distribute trust across multiple independent Oracles.
