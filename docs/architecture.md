# Architecture

Anchr's target architecture has three protocol actors:

- **Customer**: creates a request, chooses a Provider, locks payment, and
  refunds after timeout when no valid proof arrives.
- **Provider**: discovers Customer requests, quotes work, produces data plus
  proof, and redeems only after Oracle approval.
- **Oracle**: verifies proofs and releases the unlock material. The Oracle never
  takes custody of Customer or Provider funds.

Customer, Provider, and Oracle coordinate directly through Nostr events, Cashu
mint state, and encrypted Blossom attachments. A deployment may bundle multiple
roles into one process for development, but that process is not a fourth
protocol actor and must not be required for interoperability.

The current repository is mid-refactor. It still contains a host-shaped
`@anchr/bounty` package and `example/anchr-reference-host/`, but those are
implementation scaffolding around the three actor model. Concrete deployments
live in `example/`. No package depends on `example/` code: packages flow into
examples, never the other way.

## Target layer stack

The refactor target is five layers, from most reusable to most concrete:

1. `@anchr/protocol`: wire event builders/parsers, shared state machines, schema
   identifiers, validation helpers, and role-neutral types.
2. Cryptographic and storage primitives: Cashu HTLC/P2PK, FROST threshold
   signing, TLSNotary validation, photo verification, and Blossom storage.
3. Actor SDKs: `@anchr/customer-sdk`, `@anchr/provider-sdk`, and
   `@anchr/oracle-sdk`. Each SDK owns local state and injects ports for relays,
   wallets, signers, proof generation, verification, and storage.
4. Adapters: CLI, HTTP gateway, MCP, Discord bot, mobile bridge, web UI bridge,
   or any other runtime integration. Adapters call SDKs; SDKs do not depend on
   adapters.
5. Examples and apps: runnable compositions that choose relays, mints, oracles,
   schemas, UI, and operational policy.

The current package layout before that split is:

```
packages/
├── core-runtime/              Bun ↔ Deno runtime helpers (spawn, fs, which, logger, env)
├── core-cashu/                Cashu HTLC escrow + preimage store
├── tlsn-toolkit/              TLSNotary application layer (validation, replay defence, ReDoS guard)
├── photo-verification/        C2PA + EXIF + ProofMode + AI content check + GPS Haversine
├── frost-oracle/              FROST t-of-n threshold-signing primitives (BIP-340 Schnorr)
├── cashu-conditional-swap/    N:M binary-outcome conditional swap primitive (HTLC / FROST dual-key)
├── blossom/                   Encrypted attachment store (BUD-01–06 client)
├── bounty/                    Current host-shaped implementation: Query lifecycle, escrow,
│                              oracle-client/service, worker-api (HTTP), MCP (stdio).
└── sdk/                       Current Customer / Provider SDK facade for downstream consumers

example/                       Runnable apps; each owns its design system + deno.json
  ├── anchr-reference-host/    Temporary bundled runtime example, not a protocol actor
  ├── data-marketplace/        Bounty pattern with extra `/marketplace/*` routes via composeHost(extras)
  ├── two-party-binary-bet/    Market pattern (no host needed)
  └── …                        SDK consumers + standalone primitives demos
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0)
docs/                          Architecture + threat model
```

## Naming migration

Public protocol, docs, SDKs, and examples should use **Customer**, **Provider**,
and **Oracle**. The older **Requester** and **Worker** names are implementation
terms that should disappear from public surfaces as the host-shaped code is
split.

Migration rules:

- Protocol prose and public examples use Customer/Provider/Oracle now.
- New package names use `protocol`, `customer-sdk`, `provider-sdk`, and
  `oracle-sdk`.
- Current wire fields such as `requester_pubkey`, `worker_pubkey`, and
  `requester_only` remain documented as compatibility names until
  `@anchr/protocol` introduces versioned replacements.
- Internal `@anchr/bounty` domain states such as `worker_selected` may remain
  while that package exists. They should not be copied into new SDK APIs.
- After versioned replacements exist, requester/worker vocabulary should be
  removed from wire and domain contracts instead of retained as aliases.
- Adapter names should describe the integration surface, not a protocol role:
  `anchr-mcp`, HTTP gateway, CLI, mobile app, and web UI are adapters.

## Reference host status

`example/anchr-reference-host/` is a temporary bundled deployment for local
testing. It wires QueryService, worker-api HTTP routes, MCP stdio, scheduler,
and log capture into one process. It is not the network's default endpoint, not
a hosted reference URL, and not part of the protocol contract.

This tradeoff removes a convenient central demo target. In return:

- Customers, Providers, and Oracles must choose explicit relays, mints, oracle
  pubkeys/endpoints, and notaries.
- Agents and examples must not assume a default hosted Anchr server.
- Interop moves to Nostr/Cashu/Blossom wire compatibility instead of
  compatibility with a reference host REST API.
- Operators can still publish adapter endpoints, but those endpoints are app
  infrastructure, not mandatory Anchr infrastructure.

## Layer dependency rules

The package graph is one-directional. `scripts/arch-lint.ts` enforces the
allow-list; the rule codes (E001-E024) are the canonical reference. Highlights:

- Inside `packages/bounty/src/`:
  - `domain/` is pure — no `Date.now()`, no `randomBytes`, no `Deno.*`. Side
    effects come from injected ports (`Clock` / `IdGenerator` / `NonceGenerator`
    in `packages/bounty/src/domain/ports.ts`).
  - `application/` orchestrates use cases and defines ports. No `Deno.*` direct
    calls.
  - `infrastructure/` implements ports. The only layer allowed to call `Deno.*`
    and external SDKs.
- `packages/bounty/` may import any non-sdk primitive package. Other packages
  may only depend on the small allow-list under E010-E019.
- `bounty` (and any package) must not import from `@anchr/sdk` (the SDK is
  downstream of the host).
- Application vocabulary (`market`, `marketplace`, …) is forbidden inside
  `packages/`. Concrete apps own their vocabulary in `example/<app>/`.
- `example/<app>/` reaches Anchr through `@anchr/*` only — relative paths into
  `packages/<pkg>/src/...` are an E023 violation. The expo-worker-app and
  bounty-board mobile apps are excluded (they speak HTTP only).

## Attachment registry (Blossom)

Photos, large TLSN presentations, and ProofMode bundles don't fit in Nostr
events. Current adapters store them in **encrypted Blossom blobs** (AES-256-GCM,
content-addressed by SHA-256 of ciphertext, key delivery via NIP-44
`blossom_keys` field). The wire spec uses
`storage_kind: "blossom" | "external"`, so an adapter can swap in S3 / IPFS /
custom and stay protocol-compatible. Blossom itself is specified externally in
[BUD-01–06](https://github.com/hzrd149/blossom).

The thin Anchr integration (Provider upload + fetch helpers) lives in
`packages/bounty/src/infrastructure/blossom/` because the helpers decode
`AttachmentRef` / `BlossomKeyMaterial` domain types. The underlying
encrypted-store primitive ships in `packages/blossom/`.

## Specs and threat model

- Wire-format specs (Nostr DVM messaging, conditional-swap primitive, oracle
  registry) live under [`specs/`](../specs/), CC0. Anyone may implement them.
- Per-package implementation guides are each package's `SPEC.md`.
- Threat-model invariants and the attack tests pinning them are in
  [`docs/threat-model.md`](threat-model.md).
- Cross-document placement rules for universal protocol contracts, security
  invariants, package contracts, adapters, examples, and agent harness rules are
  in [`docs/universality-boundaries.md`](universality-boundaries.md).

## Relation to NIP-90

Anchr is, in one line: **NIP-90 (Nostr DVM) + Cashu HTLC settlement +
Oracle-verified proofs**.

| Layer          | What NIP-90 provides                                                                                                                              | What Anchr adds                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Transport      | Request/Result/Feedback events (kinds 5xxx/6xxx/7000), provider competition, encrypted parameters via NIP-44, capability advertisement via NIP-89 | (uses NIP-90 as is)                                                                            |
| Settlement     | "money in, data out" loosely via Lightning zap — post-delivery, trust-based                                                                       | **Cashu HTLC pre-lock with locktime refund** — atomic, escrowed                                |
| Verification   | None — the customer trusts the provider                                                                                                           | **Standardized proof types** (C2PA, GPS, ProofMode, TLSNotary)                                 |
| Trust topology | Bilateral (customer ↔ provider)                                                                                                                   | **Oracle as a third role** that gates the HTLC release. t-of-n FROST for higher-stakes queries |

Anchr is not strictly NIP-90-conformant: it overloads kind 5300 (which the
public DVM kind registry assigns to "Nostr Content Discovery") with
verifiable-data semantics. NIP-90 is a **transport choice** here, not a
strict-compatibility claim — Anchr could in principle run over a different
transport (HTTP, MQTT) and would still be Anchr.

## Composition patterns

Three patterns are demonstrated in `example/`. The first two share the same
invariant — **the Cashu Mint is the only party that moves money; the Oracle only
reveals secrets** — the third skips Cashu entirely.

### Bounty (asymmetric: one Customer, competing Providers)

A Customer locks payment in escrow; competing Providers race to fulfill the
query; the Oracle verifies the submitted proof and reveals the preimage that
lets the winning Provider redeem. If no proof verifies before the locktime, the
Cashu mint refunds the Customer.

Used by: query/data examples (C2PA, supply-chain, auto-claim, fiat-swap).

### Market (symmetric: two counterparties, matched bilaterally)

Two bettors take opposite sides of a binary outcome. A matchmaker pairs them but
never touches funds. Each bettor performs a **bilateral cross-lock** at the
Mint: their tokens are locked under the _counterparty's_ pubkey and the
_opposite outcome's_ hash. The Oracle reveals one preimage (or FROST signature)
— the winner uses it plus their own signature to redeem the loser's locked
token.

Used by: two-party-binary-bet. Imports `@anchr/cashu-conditional-swap` +
`@anchr/frost-oracle` directly (no SDK).

**Why the three-way distinction matters**: Bounty and Market are settlement
compositions (payment is on-protocol via Cashu); Verification-only is a
non-settlement composition (Anchr provides only the verification layer). Future
use cases will be variations on these three shapes, mixing the same primitives
differently.
