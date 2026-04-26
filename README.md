# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)

Toolkit for atomically exchanging cryptographic proofs and Bitcoin (Cashu) payments without a trusted third party.

A Requester posts a bounty. A Worker produces a cryptographic proof (TLSNotary for HTTPS responses, C2PA for photos, GPS for location, ProofMode for mobile capture). An Oracle verifies the proof. Payment releases only when verification passes.

- Requester can't revoke payment (sats locked in escrow before work begins) — see [INV-03](docs/threat-model.md#inv-03-requester-cant-unlock-escrow-before-timeout)
- Worker can't forge proofs (verification is cryptographic) — see [INV-01](docs/threat-model.md#inv-01-worker-cant-forge-tlsn-proofs)
- Oracle can't steal funds (escrow requires Worker's signature to redeem) — see [INV-02](docs/threat-model.md#inv-02-oracle-cant-release-preimage-without-valid-proof)
- For high-value queries, t-of-n independent Oracles verify via FROST threshold signing

## Packages

Anchr is a monorepo of independent packages plus a reference host server. Each package is usable on its own — pick what you need.

```
packages/
├── core-runtime/              Bun ↔ Deno runtime compat (spawn, fs, which, moduleDir)
├── core-domain/               Shared domain types (Query, Worker, Oracle, AttachmentRef, …)
├── core-cashu/                Cashu HTLC escrow + preimage store
├── tlsn-toolkit/              TLSNotary application layer (validation, ReDoS-safe conditions, replay protection)
├── photo-bounty/              Photo verification (C2PA + EXIF + ProofMode + AI check + GPS Haversine)
├── cashu-frost-oracle/        FROST t-of-n cluster for Cashu P2PK threshold signing
├── cashu-conditional-swap/    N:M binary outcome conditional swap primitive (HTLC dual-preimage + FROST dual-key)
└── sdk/                       AI agent SDK + CLI (HTTP client for the Anchr server)

src/                           Reference host server: Hono HTTP API, Nostr/Blossom integrations, oracle wiring
example/                       7 worked examples that compose the packages above
crates/                        Rust crates: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
```

### Package details

| Package | Purpose | Independent of host? |
|---------|---------|---|
| `core-runtime` | Deno runtime helpers (spawn, file I/O, PATH lookup, module dir) | ✅ |
| `core-domain` | Type definitions for Query / QueryResult / Oracle / Attachment / Blossom keys | ✅ |
| `core-cashu` | HTLC escrow primitive (`createHtlcToken`, `redeemHtlcToken`) + preimage store | ⚠️ Imports host's wallet (`src/infrastructure/cashu/wallet`) for mint config |
| `tlsn-toolkit` | `validateTlsn`, `evaluateCondition`, `isSuspiciousRegex` (ReDoS guard), replay protection, subprocess wrapper for the `tlsn-verifier` Rust binary | ✅ |
| `photo-bounty` | `validateC2pa`, `validateExif`, `parseProofModeZip`, `createAiContentChecker` (DI), `haversineKm`, `integrity-store` | ✅ |
| `cashu-frost-oracle` | `createFrostCoordinator`, `coordinateSigning`, FROST DKG/sign CLI wrapper | ✅ |
| `cashu-conditional-swap` | `createSwapPairTokens` (cross-HTLC), `createDualPreimageStore`, `createDualKeyStore` (FROST dual-key) | Depends on `core-cashu` and `cashu-frost-oracle` |
| `sdk` (`anchr-sdk`) | TypeScript HTTP client + CLI + MCP integration for AI agents | Targets a deployed Anchr server |

## Architecture

| Layer | Implementation | Where it lives |
|-------|---------------|---|
| Payment | Cashu NUT-11 P2PK + NUT-14 HTLC | `packages/core-cashu/` |
| Web Verification | TLSNotary MPC-TLS | `packages/tlsn-toolkit/` + `crates/tlsn-*` |
| Photo Verification | C2PA + EXIF + ProofMode + AI check | `packages/photo-bounty/` |
| Threshold Signing | FROST t-of-n BIP-340 Schnorr | `packages/cashu-frost-oracle/` + `crates/frost-signer/` |
| Conditional Swap | HTLC dual-preimage / FROST dual-key | `packages/cashu-conditional-swap/` |
| Messaging | Nostr (NIP-90 DVM, NIP-44 DM) | `src/infrastructure/nostr/` |
| Storage | Blossom (AES-256-GCM) | `src/infrastructure/blossom/` |

Each layer is pluggable. Swapping Cashu for Fedimint, or TLSNotary for another zkTLS provider, means implementing an adapter.

## Protocol Flow

```
Requester → lock escrow → post query (Nostr)
                                ↓
Worker discovers → produces proof (TLSNotary / C2PA / ProofMode / GPS)
                                ↓
Oracle verifies → reveals preimage or FROST signature
                                ↓
Worker redeems at Cashu Mint → Requester gets verified data
                                ↓
            timeout? → escrow refunds to Requester
```

## Examples

Each example is independently runnable (own `deno.json`) and composes the packages above.

| Example | What it composes |
|---------|------------------|
| [Prediction Market](example/prediction-market/) | `cashu-conditional-swap` + `cashu-frost-oracle` + `tlsn-toolkit` |
| [Airdrop Bot Shield](example/airdrop-bot-shield/) | `tlsn-toolkit` + `core-cashu` for Sybil-resistant airdrop |
| [Auto-Claim](example/auto-claim/) | `tlsn-toolkit` + `anchr-sdk` for automated claim filing |
| [C2PA Media Verification](example/c2pa-media-verification/) | `photo-bounty` for camera-signed photo proof |
| [Supply Chain Proof](example/supply-chain-proof/) | `photo-bounty` (GPS + C2PA + ProofMode) |
| [TLSN Fiat Swap (Square)](example/tlsn-fiat-swap-square/) | `tlsn-toolkit` + `core-cashu` + `anchr-sdk` |
| [Bounty Board](example/bounty-board/) | Expo mobile client for the host server |

## Quick Start

Run the reference host server:

```bash
deno install
deno task build:ui && deno task build:css
deno task dev                        # http://localhost:3000
```

With FROST Oracle cluster:

```bash
cd crates/frost-signer && cargo build --release
deno run --allow-all scripts/frost-dkg-bootstrap.ts
deno run --allow-all scripts/frost-oracle-cluster.ts
```

With Docker (Cashu + Lightning + Nostr + Blossom):

```bash
docker compose up -d && sleep 25 && ./scripts/init-regtest.sh
deno task test:regtest               # E2E tests against regtest
```

## Testing

```bash
deno task test:ci         # unit + protocol + all packages (CI pipeline)
deno task test:example    # all 7 example apps
deno task test:regtest    # Cashu + Lightning E2E (Docker)
deno task test:frost      # FROST threshold signing
deno task test            # everything (including e2e)
```

Current baseline: **313 tests / 975 steps / 0 failed** (250 host + 63 examples).

## API (host server)

<details>
<summary>Endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/queries` | Create query |
| `GET` | `/queries` | List open queries |
| `GET` | `/queries/:id` | Query detail |
| `POST` | `/queries/:id/quotes` | Worker submits quote |
| `POST` | `/queries/:id/select` | Select Worker |
| `POST` | `/queries/:id/begin` | Worker begins work |
| `POST` | `/queries/:id/result` | Submit proof + verify + settle |
| `POST` | `/queries/:id/cancel` | Cancel query |
| `POST` | `/hash` | Oracle generates preimage/hash |
| `GET` | `/oracles` | List oracles |
| `GET` | `/health` | Health check |

</details>

<details>
<summary>Configuration</summary>

| Variable | Description |
|----------|-------------|
| `NOSTR_RELAYS` | Relay WebSocket URLs |
| `BLOSSOM_SERVERS` | Blossom blob server URLs |
| `CASHU_MINT_URL` | Cashu mint URL |
| `TLSN_VERIFIER_URL` | TLSNotary Verifier URL |
| `FROST_CONFIG_PATH` | FROST node config file |
| `HTTP_API_KEY` | API key for write endpoints |
| `AI_CONTENT_CHECK` | `true` to enable vision-LLM content check (opt-in) |
| `ANTHROPIC_API_KEY` | Required when `AI_CONTENT_CHECK=true` |

</details>

## Polyrepo migration

Each package in `packages/` is **polyrepo-ready** — it has its own `deno.json` with `name`, `version`, `exports`, scoped imports, and tasks. Inter-package imports use package names (`@anchr/core-runtime`, `@anchr/core-domain/types`, …) resolved via the Deno workspace declared in the root `deno.json`.

To split any package into its own repo:

1. Move `packages/<name>/` to a fresh repository
2. In its `deno.json`, replace `"@anchr/<dep>": "../<dep>/src/..."` with `"@anchr/<dep>": "jsr:@anchr/<dep>@^0.1"`
3. Publish with `deno publish`

Each package can be tested standalone: `cd packages/<name> && deno task test`. The combined `test:ci` exercises the same code via the workspace.

## Specifications

Protocol specs in [`specs/`](specs/). Released under CC0 (public domain). Anyone may implement them.

Refactor history and migration patterns in [`docs/refactor-plan.md`](docs/refactor-plan.md).

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE)
