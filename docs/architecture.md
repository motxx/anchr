# Architecture

Anchr is nine independently typecheckable packages. Concrete deployments
live in `example/`; the reference host is `example/anchr-reference-host/`.
No package depends on `example/` code — packages flow into examples,
never the other way.

```
packages/
├── core-runtime/              Bun ↔ Deno runtime helpers (spawn, fs, which, logger, env)
├── core-cashu/                Cashu HTLC escrow + preimage store
├── tlsn-toolkit/              TLSNotary application layer (validation, replay defence, ReDoS guard)
├── photo-verification/        C2PA + EXIF + ProofMode + AI content check + GPS Haversine
├── frost-oracle/              FROST t-of-n threshold-signing primitives (BIP-340 Schnorr)
├── cashu-conditional-swap/    N:M binary-outcome conditional swap primitive (HTLC / FROST dual-key)
├── blossom/                   Encrypted attachment store (BUD-01–06 client)
├── bounty/                    Anchr Bounty implementation — Query lifecycle, escrow, oracle-client/service,
│                              worker-api (HTTP), MCP (stdio). Embed via `composeHost(extras)`.
└── sdk/                       anchr-sdk: Customer / Provider API for downstream consumers

example/                       Runnable apps; each owns its design system + deno.json
  ├── anchr-reference-host/    Minimal `startReferenceRuntime()` deployment
  ├── data-marketplace/        Bounty pattern with extra `/marketplace/*` routes via composeHost(extras)
  ├── two-party-binary-bet/    Market pattern (no host needed)
  └── …                        SDK consumers + standalone primitives demos
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0)
docs/                          Architecture + threat model
```

## Layer dependency rules

The package graph is one-directional. `scripts/arch-lint.ts` enforces
the allow-list; the rule codes (E001-E024) are the canonical reference.
Highlights:

- Inside `packages/bounty/src/`:
  - `domain/` is pure — no `Date.now()`, no `randomBytes`, no
    `Deno.*`. Side effects come from injected ports (`Clock` /
    `IdGenerator` / `NonceGenerator` in
    `packages/bounty/src/domain/ports.ts`).
  - `application/` orchestrates use cases and defines ports. No
    `Deno.*` direct calls.
  - `infrastructure/` implements ports. The only layer allowed to
    call `Deno.*` and external SDKs.
- `packages/bounty/` may import any non-sdk primitive package. Other
  packages may only depend on the small allow-list under E010-E019.
- `bounty` (and any package) must not import from `@anchr/sdk`
  (the SDK is downstream of the host).
- Application vocabulary (`market`, `marketplace`, …) is forbidden
  inside `packages/`. Concrete apps own their vocabulary in
  `example/<app>/`.
- `example/<app>/` reaches Anchr through `@anchr/*` only — relative
  paths into `packages/<pkg>/src/...` are an E023 violation. The
  expo-worker-app and bounty-board mobile apps are excluded (they
  speak HTTP only).

## Attachment registry (Blossom)

Photos, large TLSN presentations, and ProofMode bundles don't fit in
Nostr events. The reference host stores them in **encrypted Blossom
blobs** (AES-256-GCM, content-addressed by SHA-256 of ciphertext, key
delivery via NIP-44 `blossom_keys` field). The wire spec uses
`storage_kind: "blossom" | "external"`, so a host can swap in S3 / IPFS
/ custom and stay protocol-compatible. Blossom itself is specified
externally in [BUD-01–06](https://github.com/hzrd149/blossom).

The thin Anchr integration (worker upload + fetch helpers) lives in
`packages/bounty/src/infrastructure/blossom/` because the helpers
decode `AttachmentRef` / `BlossomKeyMaterial` domain types. The
underlying encrypted-store primitive ships in `packages/blossom/`.

## Specs and threat model

- Wire-format specs (Nostr DVM messaging, conditional-swap primitive,
  oracle registry) live under [`specs/`](../specs/), CC0. Anyone may
  implement them.
- Per-package implementation guides are each package's `SPEC.md`.
- Threat-model invariants and the attack tests pinning them are in
  [`docs/threat-model.md`](threat-model.md).

## Relation to NIP-90

Anchr is, in one line: **NIP-90 (Nostr DVM) + Cashu HTLC settlement +
Oracle-verified proofs**.

| Layer | What NIP-90 provides | What Anchr adds |
|---|---|---|
| Transport | Request/Result/Feedback events (kinds 5xxx/6xxx/7000), provider competition, encrypted parameters via NIP-44, capability advertisement via NIP-89 | (uses NIP-90 as is) |
| Settlement | "money in, data out" loosely via Lightning zap — post-delivery, trust-based | **Cashu HTLC pre-lock with locktime refund** — atomic, escrowed |
| Verification | None — the customer trusts the provider | **Standardized proof types** (C2PA, GPS, ProofMode, TLSNotary) |
| Trust topology | Bilateral (customer ↔ provider) | **Oracle as a third role** that gates the HTLC release. t-of-n FROST for higher-stakes queries |

Anchr is not strictly NIP-90-conformant: it overloads kind 5300 (which
the public DVM kind registry assigns to "Nostr Content Discovery") with
verifiable-data semantics. NIP-90 is a **transport choice** here, not a
strict-compatibility claim — Anchr could in principle run over a
different transport (HTTP, MQTT) and would still be Anchr.

## Composition patterns

Three patterns are demonstrated in `example/`. The first two share the
same invariant — **the Cashu Mint is the only party that moves money;
the Oracle only reveals secrets** — the third skips Cashu entirely.

### Bounty (asymmetric: one buyer, competing workers)

A Requester locks payment in escrow; competing Workers race to fulfill
the query; the Oracle verifies the submitted proof and reveals the
preimage that lets the winning Worker redeem. If no proof verifies
before the locktime, the Cashu mint refunds the Requester.

Used by: query/data examples (C2PA, supply-chain, auto-claim,
fiat-swap).

### Market (symmetric: two counterparties, matched bilaterally)

Two bettors take opposite sides of a binary outcome. A matchmaker pairs
them but never touches funds. Each bettor performs a **bilateral
cross-lock** at the Mint: their tokens are locked under the
*counterparty's* pubkey and the *opposite outcome's* hash. The Oracle
reveals one preimage (or FROST signature) — the winner uses it plus
their own signature to redeem the loser's locked token.

Used by: two-party-binary-bet. Imports `@anchr/cashu-conditional-swap` +
`@anchr/frost-oracle` directly (no SDK).

### Verification-only chain (no Cashu)

A multi-hop evidence chain — supply-chain audit, news provenance,
document authenticity — uses `photo-verification` and `tlsn-toolkit` to
produce per-hop attestations linked through Nostr, but settlement
happens off-protocol (typically fiat invoices in supply-chain finance,
or no settlement at all in pure audit chains).

Used by: `royalty-distribution` (digital rights graph),
`supply-chain-proof` (physical multi-hop). Neither uses
`cashu-conditional-swap`.

**Why the three-way distinction matters**: Bounty and Market are
settlement compositions (payment is on-protocol via Cashu);
Verification-only is a non-settlement composition (Anchr provides only
the verification layer). Future use cases will be variations on these
three shapes, mixing the same primitives differently.
