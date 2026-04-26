# Anchr Wire-Format Specifications

This directory holds the **wire-format specs** that an alternative
implementation needs to be interoperable with the reference Anchr host
and clients on the network. Anything that is purely host- or
package-internal lives elsewhere — see *Where everything else moved* at
the bottom.

All specs in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain). Anyone may implement them.

## Specs

| # | Title | Why it's wire-format |
|---|-------|----------------------|
| [05](05-messaging.md) | Nostr DVM Messaging | NIP-90 event kinds (5300/6300/7000) used by every Anchr Requester / Worker / Oracle to discover each other and exchange queries, quotes, and proofs. |
| [07](07-conditional-swap.md) | Conditional Swap | Cross-locked Cashu-token primitive (HTLC dual-preimage, FROST P2PK dual-key). Required reading for any prediction-market / N:M client that wants to interop with `@anchr/cashu-conditional-swap`. |
| [08](08-oracle-registry.md) | Oracle Registry | Nostr kind-30088 announcement + discovery format. Required for any Oracle that wants to be discovered by the network. |

## Where everything else moved

The following specs were folded into the package or host that owns the
behavior — they were implementation guides, not interop contracts.

| Old spec | New home | Reason |
|---|---|---|
| `00-overview.md` | Root [`README.md`](../README.md) | The README now serves as the elevator pitch + protocol-flow diagram. |
| `01-query-lifecycle.md` | [`docs/host-query-lifecycle.md`](../docs/host-query-lifecycle.md) | The `Query` state machine is host-internal (`src/domain/query-store.ts`); other implementations are free to model state differently. |
| `02-escrow.md` (HTLC parts) | [`packages/core-cashu/SPEC.md`](../packages/core-cashu/SPEC.md) | Cashu NUT-11/14 usage and the `EscrowProvider` interface that this package implements. |
| `02-escrow.md` (P2PK + FROST parts) + `04-threshold-oracle.md` | [`packages/cashu-frost-oracle/SPEC.md`](../packages/cashu-frost-oracle/SPEC.md) | FROST DKG / signing flow and the P2PK+FROST escrow that this package wires up. |
| `03-verification.md` (TLSNotary parts) | [`packages/tlsn-toolkit/SPEC.md`](../packages/tlsn-toolkit/SPEC.md) | MPC-TLS application-layer hardening (replay defence, ReDoS-safe conditions, freshness, credential-leakage guard). |
| `03-verification.md` (photo / GPS parts) | [`packages/photo-bounty/SPEC.md`](../packages/photo-bounty/SPEC.md) | C2PA / ProofMode / GPS / vision-LLM verifier specifics. |
| `06-storage.md` | [`docs/host-storage.md`](../docs/host-storage.md) | Blossom usage + NIP-44 key delivery is the reference host's choice; Blossom itself is specified externally in BUD-01–06. |

The cryptographic + protocol-state invariants that anchor security
claims are tracked in [`docs/threat-model.md`](../docs/threat-model.md)
and CI-enforced via `deno task lint:invariants`.

## License

All specifications in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain).
