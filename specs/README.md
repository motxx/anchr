# Anchr Wire-Format Specifications

This directory holds the **wire-format specs** that Customer, Provider, and
Oracle implementations need in order to interoperate on the Anchr network.
Anything that is purely adapter-, host-, or package-internal lives elsewhere;
see _Where everything else lives_ at the bottom.

All specs in this directory are released under [CC0 1.0 Universal](LICENSE)
(public domain). Anyone may implement them.

## Specs

| Title                                               | Why it belongs in `specs/`                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Universal Protocol Contract](protocol-contract.md) | Role-neutral lifecycle, message classes, capability requirements, state transitions, Provider preflight, and redeem rules shared by independent Anchr implementations.                               |
| [Nostr DVM Messaging](messaging.md)                 | NIP-90 event kinds (5300/6300/7000) used by every Anchr Customer / Provider / Oracle to discover each other and exchange queries, offers, and proofs.                                                |
| [Conditional Swap](conditional-swap.md)             | Cross-locked Cashu-token primitive (HTLC dual-preimage, FROST P2PK dual-key). Required reading for any two-party-binary-bet / N:M client that wants to interoperate with compatible Anchr settlement code. |
| [Oracle Registry](oracle-registry.md)               | Nostr kind-30088 announcement + discovery format. Required for any Oracle that wants to be discovered by the network.                                                                                |
| [Proof Schema URLs](proof-schemas.md)               | HTTPS URL identifiers and matching rules for proof generator and verifier dispatch.                                                                                                                  |

## Where everything else lives

Topics that are adapter-, host-, or package-internal aren't part of the
cross-implementation contract; they live alongside the code that owns them.

| Topic                                              | Home                                                                            | Why it's not in `specs/`                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Protocol overview / elevator pitch / product story | Root [`README.md`](../README.md)                                                | Lives with the project landing page.                                                                        |
| Target architecture / role boundaries              | [`docs/architecture.md`](../docs/architecture.md)                               | Design-level actor and layer decisions, not a wire payload.                                                 |
| `Query` state machine                              | `packages/sdk/src/requests/domain/query-transitions.ts`                         | Current SDK implementation detail; other implementations are free to model local state differently.          |
| Cashu HTLC escrow (NUT-11 / NUT-14)                | `packages/sdk/src/payments/` and `packages/sdk/src/adapters/cashu.ts`           | Cashu mint / wallet usage and SDK payment adapter interfaces.                                               |
| FROST DKG + threshold P2PK escrow                  | `packages/sdk/src/payments/frost-*` and `packages/sdk/src/adapters/oracle-*`    | DKG flow, threshold signing, and the P2PK + FROST escrow this SDK wiring supports.                           |
| TLSNotary application-layer hardening              | `packages/sdk/src/proofs/tlsn-*`                                                | Replay defence, ReDoS-safe conditions, freshness, credential-leakage guard.                                 |
| Photo / GPS / C2PA verification                    | `packages/sdk/src/proofs/`                                                      | C2PA / ProofMode / GPS / verifier specifics.                                                               |
| Encrypted Blossom storage + NIP-44 key delivery    | `packages/sdk/src/attachments/` and `packages/sdk/src/adapters/nostr/`          | Current adapter wiring; Blossom itself is specified externally in BUD-01-06.                                |

The cryptographic + protocol-state invariants that anchor security claims are
tracked in [`docs/threat-model.md`](../docs/threat-model.md) and CI-enforced via
`deno task lint:invariants`.

For the broader placement rule that separates universal protocol contracts from
architecture, package, adapter, example, and agent harness decisions, see
[`docs/universality-boundaries.md`](../docs/universality-boundaries.md).

Reference packages and adapters should link to the relevant spec section from
their README, implementation docs, or focused tests instead of duplicating
normative text. Tests that pin a universal protocol behavior should name the
spec section or threat-model invariant they cover when practical.

## License

All specifications in this directory are released under
[CC0 1.0 Universal](LICENSE) (public domain).
