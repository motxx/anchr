# Anchr Protocol Specifications

Anchr is a protocol for atomically exchanging cryptographic proofs and Bitcoin payments without a trusted third party.

These specifications define the protocol behavior. Anyone may implement them.

## Specs

| # | Title | Summary |
|---|-------|---------|
| [00](00-overview.md) | Overview | Roles, agnostic design, security properties |
| [01](01-query-lifecycle.md) | Query Lifecycle | State machine, transitions, expiry |
| [02](02-escrow.md) | Escrow | HTLC, P2PK+FROST, provider interface |
| [03](03-verification.md) | Verification | TLSNotary, C2PA, Oracle interface |
| [04](04-threshold-oracle.md) | Threshold Oracle | FROST DKG, t-of-n signing, quorum |
| [05](05-messaging.md) | Messaging | Nostr DVM (NIP-90), event kinds, payloads |
| [06](06-storage.md) | Storage | Blossom, E2E encryption, blob lifecycle |
| [07](07-conditional-swap.md) | Conditional Swap | N:M primitive, binary outcomes, prediction markets |

## License

All specifications in this directory are released under [CC0 1.0 Universal](LICENSE) (public domain).
