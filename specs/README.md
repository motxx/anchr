# Anchr Specifications

This directory holds the Anchr v0 paid-request exchange contract and the Nostr
wire-format specs that Customer, Provider, and Oracle implementations use to
interoperate. Anything that is purely host-, package-, or SDK-internal lives
elsewhere; see _Where everything else lives_ at the bottom.

All specs in this directory are released under [CC0 1.0 Universal](LICENSE)
(public domain). Anyone may implement them.

## Specs

| Title                                             | Why it belongs in `specs/`                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Paid Request Exchange](paid-request-exchange.md) | Nostr-native, Cashu-settled v0 exchange contract: actors, request/offer/selection/proof/release/redeem links, Cashu Payment Lock, and redeem/refund safety rules. |
| [Nostr DVM Messaging](messaging.md)               | NIP-90 event kinds (5300/6300/7000), tags, payloads, signing rules, and NIP-44 encryption boundaries for the paid-request exchange.                               |
| [Oracle Registry](oracle-registry.md)             | Nostr kind-30088 announcement + discovery format for Oracle discovery.                                                                                            |
| [Proof Schema URLs](proof-schemas.md)             | HTTPS URL identifiers and matching rules for proof generator and verifier dispatch.                                                                               |

## Where everything else lives

Topics that are adapter-, host-, or package-internal aren't part of the
cross-implementation contract; they live alongside the code that owns them.

| Topic                                              | Home                                                                         | Why it's not in `specs/`                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Protocol overview / elevator pitch / product story | Root [`README.md`](../README.md)                                             | Lives with the project landing page.                                                                      |
| Target architecture / role boundaries              | [`docs/architecture.md`](../docs/architecture.md)                            | Design-level actor and layer decisions, not a wire payload.                                               |
| `Query` state machine                              | `packages/sdk/src/requests/domain/query-transitions.ts`                      | Current SDK implementation detail; other implementations are free to model local state differently.       |
| Cashu mint/wallet operation details                | `packages/sdk/src/payments/` and `packages/sdk/src/adapters/cashu.ts`        | The v0 Payment Lock is Cashu, but wallet calls and mint adapter mechanics are SDK implementation details. |
| FROST DKG + threshold P2PK helpers                 | `packages/sdk/src/payments/frost-*` and `packages/sdk/src/adapters/oracle-*` | DKG flow, threshold signing, and helper wiring are SDK implementation details unless a future profile promotes them. |
| N:M conditional settlement design                  | [`docs/conditional-swap-design.md`](../docs/conditional-swap-design.md)      | Retained design material, not an active v0 protocol spec or public SDK surface.                          |
| TLSNotary application-layer hardening              | `packages/sdk/src/proofs/tlsn-*`                                             | Replay defence, ReDoS-safe conditions, freshness, credential-leakage guard.                               |
| Photo / GPS / C2PA verification                    | `packages/sdk/src/proofs/`                                                   | C2PA / ProofMode / GPS / verifier specifics.                                                              |
| Encrypted Blossom storage + NIP-44 key delivery    | `packages/sdk/src/attachments/` and `packages/sdk/src/adapters/nostr/`       | Current adapter wiring; Blossom itself is specified externally in BUD-01-06.                              |

The cryptographic + protocol-state invariants that anchor security claims are
tracked in [`docs/threat-model.md`](../docs/threat-model.md) and CI-enforced via
`deno task lint:invariants`.

For the broader placement rule that separates exchange contracts from
architecture, package, adapter, example, and agent harness decisions, see
[`docs/universality-boundaries.md`](../docs/universality-boundaries.md).

Reference packages and adapters should link to the relevant spec section from
their README, implementation docs, or focused tests instead of duplicating
normative text. Tests that pin protocol behavior should name the spec section or
threat-model invariant they cover when practical.

## License

All specifications in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain).
