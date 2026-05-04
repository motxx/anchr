# Anchr Wire-Format Specifications

This directory holds the **wire-format specs** that an alternative
implementation needs to be interoperable with the reference Anchr host
and clients on the network. Anything that is purely host- or
package-internal lives elsewhere — see *Where everything else lives* at
the bottom.

All specs in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain). Anyone may implement them.

## Specs

| Title | Why it's wire-format |
|-------|----------------------|
| [Nostr DVM Messaging](messaging.md) | NIP-90 event kinds (5300/6300/7000) used by every Anchr Requester / Worker / Oracle to discover each other and exchange queries, quotes, and proofs. |
| [Conditional Swap](conditional-swap.md) | Cross-locked Cashu-token primitive (HTLC dual-preimage, FROST P2PK dual-key). Required reading for any two-party-binary-bet / N:M client that wants to interop with `@anchr/cashu-conditional-swap`. |
| [Oracle Registry](oracle-registry.md) | Nostr kind-30088 announcement + discovery format. Required for any Oracle that wants to be discovered by the network. |

## Where everything else lives

Topics that are host- or package-internal aren't part of the
cross-implementation contract; they live alongside the code that owns
them.

| Topic | Home | Why it's not in `specs/` |
|---|---|---|
| Protocol overview / elevator pitch / role flow | Root [`README.md`](../README.md) | Lives with the project landing page. |
| `Query` state machine | [`docs/host-query-lifecycle.md`](../docs/host-query-lifecycle.md) | Host-internal (`src/domain/query-store.ts`); other implementations are free to model state differently. |
| Cashu HTLC escrow (NUT-11 / NUT-14) | [`packages/core-cashu/SPEC.md`](../packages/core-cashu/SPEC.md) | Cashu mint / wallet usage and the `EscrowProvider` interface that this package implements. |
| FROST DKG + threshold P2PK escrow | [`packages/cashu-frost-oracle/SPEC.md`](../packages/cashu-frost-oracle/SPEC.md) | DKG flow, threshold signing, and the P2PK + FROST escrow this package wires up. |
| TLSNotary application-layer hardening | [`packages/tlsn-toolkit/SPEC.md`](../packages/tlsn-toolkit/SPEC.md) | Replay defence, ReDoS-safe conditions, freshness, credential-leakage guard. |
| Photo / GPS / C2PA verification | [`packages/photo-bounty/SPEC.md`](../packages/photo-bounty/SPEC.md) | C2PA / ProofMode / GPS / vision-LLM verifier specifics. |
| Encrypted Blossom storage + NIP-44 key delivery | [`docs/host-storage.md`](../docs/host-storage.md) | Reference host's choice; Blossom itself is specified externally in BUD-01–06. |

The cryptographic + protocol-state invariants that anchor security
claims are tracked in [`docs/threat-model.md`](../docs/threat-model.md)
and CI-enforced via `deno task lint:invariants`.

## License

All specifications in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain).
