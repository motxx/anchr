# Architecture

Anchr's target architecture has three protocol actors:

- **Customer**: creates a request, chooses a Provider, locks payment, and
  refunds after timeout when no valid proof arrives.
- **Provider**: discovers Customer requests, offers work, produces data plus
  proof, and redeems only after Oracle approval.
- **Oracle**: verifies proofs and releases the unlock material. The Oracle never
  takes custody of Customer or Provider funds.

Customer, Provider, and Oracle coordinate directly through Nostr events, Cashu
mint state, and encrypted Blossom attachments. A deployment may bundle multiple
roles into one process for development, but that process is not a fourth
protocol actor and must not be required for interoperability.

The repository still contains `@anchr/bounty` as migration scaffolding around
the three actor model, but the bundled Reference Host and shared worker HTTP
gateway have been removed. Concrete deployments live in `example/`. No package
depends on `example/` code: packages flow into examples, never the other way.

## Target layer stack

The refactor target is five layers, from most reusable to most concrete:

1. `@anchr/protocol`: wire event builders/parsers, shared state machines, schema
   identifiers, validation helpers, and role-neutral types.
2. Cryptographic and storage primitives: Cashu HTLC/P2PK, FROST threshold
   signing, TLSNotary validation, photo verification, and Blossom storage.
3. Actor SDKs: `@anchr/customer-sdk`, `@anchr/provider-sdk`, and
   `@anchr/oracle-sdk`. Each SDK owns local state and injects ports for relays,
   wallets, signers, proof generation, verification, and storage.
4. Adapters: CLI, app-owned HTTP routes, MCP, Discord bot, mobile bridge, web UI bridge,
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
├── adapters/                  Shared Cashu, Nostr, and state adapter implementations.
├── protocol/                  Pure protocol helpers: wire event builders/parsers,
│                              schema identifiers, and role-neutral types.
├── oracle-sdk/                Oracle client port and simple HTTP hash-client adapter.
├── customer-sdk/              Customer local state, request flow, HTLC lock/bind, and ports.
├── provider-sdk/              Provider request handling, offer/result flow, redeem gate, and ports.
├── bounty/                    Migration scaffolding: Query lifecycle, escrow,
│                              oracle-client/service, verification adapters.
└── sdk/                       Aggregate convenience package for actor SDKs and app adapter clients.

example/                       Runnable apps; each owns its design system + deno.json
  ├── anchr-mcp/               MCP stdio adapter for agent runtime integration
  ├── data-marketplace/        App-owned `/marketplace/*` routes plus MCP tools
  ├── two-party-binary-bet/    Market pattern (no host needed)
  └── …                        SDK consumers + standalone primitives demos
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0)
docs/                          Architecture + threat model
```

### Package boundary review

The current `packages/` tree is intentionally transitional. The repository's
primary deliverables are the protocol/spec contract, actor SDKs, replaceable
adapters, proof engines, settlement primitives, and runnable reference
implementations. Package ownership should be judged by that purpose rather than
by historical placement.

| Current package | Boundary decision | Migration note |
| --- | --- | --- |
| `protocol` | Core protocol helper package. | Keep as the role-neutral wire/schema/event surface. It must not depend on other `@anchr/*` packages. |
| `customer-sdk`, `provider-sdk`, `oracle-sdk` | Core actor SDKs. | Keep actor orchestration and public actor ports here; move concrete Cashu, Nostr, and state implementations to adapter packages when those boundaries exist. |
| `adapters` | Shared concrete adapter package. | Own Cashu, Nostr, and state implementations used by apps and the aggregate SDK; actor SDKs consume only the injected port shapes. |
| `sdk` | Aggregate developer entry point. | Keep as the convenience package that re-exports actor SDKs and standard adapters; do not let lower-level packages depend on it. |
| `core-runtime` | Cross-runtime support primitive. | Keep as the dependency root for process, fs, env, which, and logging helpers. |
| `core-cashu` | Settlement primitive. | Make this the canonical Cashu HTLC/P2PK implementation before adapter extraction; avoid parallel settlement semantics in SDK adapter code. |
| `cashu-conditional-swap` | Settlement composition primitive. | Keep as a reusable conditional-swap package layered on Cashu/FROST primitives. |
| `frost-oracle` | Threshold-signing settlement primitive. | Treat as a FROST/P2PK release-authority component, not as the actor-level Oracle SDK. Distributed FROST signing should use async signing ports. |
| `tlsn-toolkit`, `photo-verification` | Proof engines. | Keep as reusable verification packages. Flow-specific dispatch belongs in adapters or flow packages. |
| `blossom` | Attachment transport/storage primitive. | Keep replaceable; it may become an adapter package once the adapter tree exists. |
| `bounty` | Transitional flow scaffold. | Shrink toward `flows/bounty` plus separate Nostr, Cashu, Blossom, Oracle, and proof adapters. Do not add new app-specific vocabulary here. |

The accepted migration order is:

1. Document the target taxonomy and public package naming decision.
2. Canonicalise Cashu settlement semantics in the settlement primitive layer.
3. Extract duplicated SDK adapter implementations into shared adapter packages.
4. Introduce an explicit async threshold-signing/release-authority port for
   FROST-backed settlement.
5. Split `bounty` into flow logic plus adapter/proof packages.
6. Separate maintained apps from small examples and sketches.
7. Update architecture lint, workspace config, package READMEs, and agent docs
   to enforce the final boundaries.

This review is tracked by issues `0037` through `0043`. Those issues own the
actual moves, API changes, lint updates, and documentation edits.

### Target directory taxonomy

The accepted target tree is a package taxonomy, not only a filesystem cleanup.
Each top-level package group names the owner of a boundary:

```
packages/
├── protocol/                  Wire events, schema ids, role-neutral types
├── sdk/
│   ├── customer/              Customer actor orchestration and ports
│   ├── provider/              Provider actor orchestration and ports
│   ├── oracle/                Oracle actor/client ports
│   └── anchr/                 Aggregate developer entry point
├── adapters/
│   ├── nostr/                 Relay transport, NIP-44/NIP-90 bindings
│   ├── cashu/                 Cashu HTLC wallet adapter over settlement primitives
│   ├── blossom/               Attachment transport adapter
│   ├── state/                 Memory, IndexedDB, and future durable actor state
│   └── oracle-http/           HTTP Oracle client/server adapter surfaces
├── proofs/
│   ├── tlsn/                  TLSNotary validation and redaction
│   └── photo/                 C2PA, EXIF, ProofMode, AI-content checks, GPS
├── settlement/
│   ├── cashu-htlc/            Canonical Cashu HTLC/P2PK construction
│   ├── conditional-swap/      Binary-outcome conditional swap composition
│   └── frost-oracle/          FROST threshold signing and release authority
├── runtime/                   Cross-runtime helpers and logging
└── flows/
    ├── bounty/                Reusable bounty/query lifecycle
    └── claim-gate/            Reusable claim-gating flow, if kept package-owned

apps/                          Maintained runnable product or adapter surfaces
examples/                      Small demos, sketches, and integration fixtures
crates/                        Native helper binaries
specs/                         Universal wire/protocol contracts
```

Public import names do not need to mirror the target directory names one-to-one,
but every published name must have one clear owner. During pre-1.0 migration,
prefer direct rewrites over compatibility shims: move a surface, update all
imports and docs in the same change, and delete the replaced path unless the
maintainer explicitly accepts a temporary facade. The intended stable public
families are:

- `@anchr/protocol` for wire and schema helpers.
- `@anchr/customer`, `@anchr/provider`, `@anchr/oracle`, and `@anchr/sdk` for
  actor SDK entry points if public names are simplified.
- `@anchr/adapters-*` or equivalent adapter packages for Nostr, Cashu, Blossom,
  state, and Oracle HTTP bindings.
- `@anchr/proofs-*` for proof engines.
- `@anchr/settlement-*` for Cashu, conditional-swap, and FROST settlement
  primitives.

If the package names stay as `@anchr/customer-sdk`, `@anchr/provider-sdk`, and
similar, the same ownership rules still apply: actor SDK packages own actor
orchestration, not concrete technology adapters.

## Agnostic component boundaries

Component names describe protocol responsibilities, not today's bindings. A
boundary is stable when replacing its current binding changes only adapter
code, primitive-package implementation, or package `SPEC.md` guidance.
Normative cross-implementation capability requirements live in
[`specs/protocol-contract.md`](../specs/protocol-contract.md). This table records
architecture placement, failure surfaces, and current repository bindings.
Placement of any rule derived from this table — universal contract, security
invariant, package contract, or adapter detail — follows
[`docs/universality-boundaries.md`](universality-boundaries.md); the
Customer/Provider/Oracle actor names follow
[Naming migration](#naming-migration) below.

| Component             | Stable responsibility                                                                                                                                           | Inputs                                                                                                       | Outputs                                                                                   | Failure conditions                                                                                                           | Current binding                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Actor coordination    | Move request, offer, selection, proof, release, and completion messages between Customer, Provider, and Oracle while preserving role identity and causal links. | Role pubkeys, message lifecycle state, encrypted payloads, attachment references.                            | Authenticated actor messages, reply-thread references, encrypted direct messages.         | Invalid signature, unknown role, missing causal parent, replayed or expired message, undecryptable payload.                  | Nostr DVM events, NIP-44 direct messages, relay subscriptions.                        |
| Evidence contract     | Identify what evidence a query requires and how verifiers dispatch it without embedding a verifier implementation in the protocol.                              | Proof schema URL, verification requirements, revealed evidence fields, attachment references.                | Typed proof payloads and verifier dispatch keys.                                          | Unknown schema, malformed payload, missing required evidence, schema mismatch between public tags and encrypted content.     | Proof schema URLs, TLSNotary presentations, photo / C2PA / ProofMode bundles.         |
| Verification decision | Decide whether submitted evidence satisfies the Customer's constraints and whether release material may be produced.                                            | Query constraints, submitted proof package, Oracle policy, freshness and replay context.                     | Verifier verdict, attestation, release authorization, warnings or failures.               | Forged proof, stale proof, failed condition, replay, unsupported factor, unavailable required verifier.                      | Oracle SDK, `@anchr/tlsn-toolkit`, `@anchr/photo-verification`.                       |
| Settlement lock       | Hold Customer value so the selected Provider can redeem after valid Oracle release and the Customer can refund after timeout.                                   | Amount, selected Provider key, refund key, release condition, locktime, mint or settlement backend.          | Locked payment reference, spendability facts, refund path, redeem result.                 | Insufficient amount, wrong Provider binding, expired or too-short locktime, mismatched release condition, backend rejection. | Cashu HTLC / P2PK, future Fedimint or DLC adapters.                                   |
| Release authority     | Produce the material that unlocks settlement only after verification succeeds, and bind that material to the selected work.                                     | Verification verdict, query id, request event id, payment hash, Provider key, authority key or quorum state. | Signed release message, preimage, threshold signature, or equivalent unlock material.     | Verification failure, wrong authority, quorum not met, signature mismatch, release fields not bound to the accepted work.    | Single Oracle preimage release, FROST threshold signatures.                           |
| Attachment transport  | Store and retrieve large or sensitive proof material without making the storage service a protocol actor.                                                       | Plaintext bytes, encryption key material, retention policy, recipient set.                                   | Encrypted attachment reference, content address, delivery key material.                   | Encryption failure, content-address mismatch, unavailable storage server, missing key material, retention expiry.            | Encrypted Blossom blobs; see [Attachment registry](#attachment-registry-blossom).     |
| Local actor state     | Track one actor's private progress without making local implementation state part of the network contract.                                                      | Actor configuration, observed messages, wallet state, verifier state, retry state, persisted tickets.        | Local projections, preflight tickets, idempotency records, retry schedule, audit records. | Corrupt store, conflicting events, missing idempotency record, stale local policy, failed persistence.                       | Actor SDK storage ports; current `@anchr/bounty` Query lifecycle scaffolding.         |
| Runtime adapter       | Bind an actor SDK or primitive to a concrete runtime or product surface.                                                                                        | SDK use case calls, operator config, credentials, UI or tool invocation.                                     | CLI command, app-owned HTTP route, MCP tool, mobile or web bridge.                        | Missing config, unauthorized caller, runtime I/O failure, adapter-specific validation failure.                               | `example/anchr-mcp`, `example/data-marketplace`, example apps.                         |

### Adapter Capability Contracts

Nostr, Cashu, TLSNotary, Blossom, and similar concrete technologies are adapter
or primitive-package choices. Actor SDK core code must depend on injected ports
for transport, payment, proof production, proof verification, attachments,
local state, and signing. Concrete adapters may expose
`AdapterManifest` metadata from `@anchr/protocol/capabilities` so apps and
tests can check whether an adapter satisfies the capabilities a flow needs.

Current reference adapters:

- `@anchr/adapters/nostr`: Nostr transport over relay clients.
- `@anchr/adapters/cashu`: Cashu HTLC payment and redeem over the canonical
  `@anchr/core-cashu` settlement primitives.
- `@anchr/adapters/storage`: actor local state stores, including in-memory
  stores for tests/server runtimes and IndexedDB stores for browser runtimes.
- `createKeypairSigner()` and `createNip07Signer()` in `@anchr/protocol/nostr`:
  signer ports for local keys and browser NIP-07 providers.
- `ProofGenerator` and `VerifierAdapter`: schema-selected proof engine ports.
- `@anchr/blossom` and bounty attachment helpers: encrypted attachment
  transport primitives.

Customer and Provider constructors require the runtime adapters explicitly.
They do not create relay or wallet clients behind the caller's back.

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
  `anchr-mcp`, CLI, mobile app, web UI, and app-owned HTTP surfaces are
  adapters.

## Reference host removal

`example/anchr-reference-host/` and the shared `worker-api` HTTP gateway have
been removed. MCP stdio remains in `example/anchr-mcp/`, while HTTP routes now
belong to concrete apps such as `example/data-marketplace/`. The network has no
default Anchr server, hosted reference URL, or mandatory REST compatibility
surface.

This removes a convenient central demo target. In return:

- Customers, Providers, and Oracles must choose explicit relays, mints, oracle
  pubkeys/endpoints, and notaries.
- Agents and examples must not assume a default hosted Anchr server.
- The aggregate SDK's app adapter clients target concrete app-owned HTTP
  surfaces, not a shared protocol host.
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

- Universal protocol and wire-format specs (role-neutral lifecycle, Nostr DVM
  messaging, conditional-swap primitive, oracle registry, and proof schema URL
  identity) live under [`specs/`](../specs/), CC0. Anyone may implement them.
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
