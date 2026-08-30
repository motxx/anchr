# Oracle Registry

## Abstract

Oracles announce their capabilities, fees, and endpoints via Nostr. Customers
discover available Oracles by querying relays. This spec defines the
announcement event format and discovery protocol.

## Motivation

The protocol expects Oracle IDs as an input to query creation but does not, on
its own, define how a Customer discovers which Oracles exist, what they can
verify, or how much they charge. Without a discovery mechanism, the protocol is
closed to new Oracle operators.

## Oracle Announcement Event

Oracles publish a Nostr parametrized replaceable event (NIP-78 style):

| Field     | Value                             |
| --------- | --------------------------------- |
| `kind`    | `30088`                           |
| `d` tag   | Oracle ID (unique identifier)     |
| `t` tags  | `anchr-oracle`                    |
| `s` tags  | Supported Proof Schema URLs       |
| `content` | JSON-encoded `OracleAnnouncement` |

### Tags

```json
{
  "kind": 30088,
  "tags": [
    ["d", "my-oracle-id"],
    ["t", "anchr-oracle"],
    ["s", "https://anchr-spec.org/spec/proof/tlsn/v1"],
    ["s", "https://anchr-spec.org/spec/proof/c2pa-image/v1"]
  ],
  "content": "{ ... }"
}
```

Each `s` tag is an exact Proof Schema URL the Oracle claims to verify. The
Proof Schema URL is the only verification capability key in the registry;
Proof Schema modules define any local predicate, evidence, or check vocabulary.

### OracleAnnouncement

The `content` field contains a JSON object:

| Field                          | Required | Description                                                       |
| ------------------------------ | -------- | ----------------------------------------------------------------- |
| `version`                      | yes      | Anchr JSON version; MUST be integer `0`                           |
| `name`                         | yes      | Human-readable Oracle name                                        |
| `endpoint`                     | no       | Optional Oracle-operated HTTP adapter URL                         |
| `fee_ppm`                      | yes      | Fee in parts-per-million of the payment amount (e.g., 50000 = 5%) |
| `supported_schemas`            | yes      | Array of Proof Schema URLs this Oracle supports                   |
| `supported_payment_lock_types` | yes      | Array of Payment Lock types: `htlc`, `p2pk_frost`                 |
| `min_amount_sats`              | no       | Minimum payment amount this Oracle accepts                        |
| `max_amount_sats`              | no       | Maximum payment amount this Oracle accepts                        |
| `description`                  | no       | Free-text description of the Oracle service                       |

`supported_schemas` and `supported_payment_lock_types` MUST be present even
when empty. Parsers MUST reject a non-array value, a Proof Schema value that is
not an HTTPS URL, or an unknown Payment Lock type rather than dropping the
invalid value.

### Example

```json
{
  "version": 0,
  "name": "TLSN and C2PA Oracle",
  "fee_ppm": 50000,
  "supported_schemas": [
    "https://anchr-spec.org/spec/proof/tlsn/v1",
    "https://anchr-spec.org/spec/proof/c2pa-image/v1"
  ],
  "supported_payment_lock_types": ["htlc", "p2pk_frost"],
  "min_amount_sats": 1,
  "max_amount_sats": 1000000,
  "description": "Independent Oracle with TLSNotary and C2PA image verification"
}
```

## Discovery

Customers discover Oracles by querying Nostr relays:

```json
{
  "kinds": [30088],
  "#t": ["anchr-oracle"]
}
```

To filter by Proof Schema:

```json
{
  "kinds": [30088],
  "#t": ["anchr-oracle"],
  "#s": ["https://anchr-spec.org/spec/proof/tlsn/v1"]
}
```

## Liveness

Oracles SHOULD republish their announcement at a regular interval (e.g.,
hourly). Clients MAY filter by `since` to discover only recently active Oracles.

A parametrized replaceable event (kind 30088 with `d` tag) replaces the previous
announcement for the same Oracle ID, keeping relay storage bounded.

## Trust Model

The announcement is self-reported. It tells you what an Oracle _claims_ to
support, not what it _actually_ supports. The cryptographic verification in
[`paid-request-exchange.md`](./paid-request-exchange.md) and
[`proof-schemas.md`](./proof-schemas.md) is what enforces correctness — the
registry is a convenience for discovery, not a trust mechanism.

Customers SHOULD:

- Verify Oracle pubkeys against a trusted whitelist for high-value queries.
- Choose explicit Oracle pubkeys and endpoints; there is no protocol default
  hosted Oracle.
- Use a threshold Oracle group backed by the SDK FROST signing helpers and P2PK
  Payment Lock helpers to distribute trust across multiple independent Oracles.
