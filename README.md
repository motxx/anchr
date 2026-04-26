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
| `core-cashu` | HTLC escrow primitive (`createHtlcToken`, `redeemHtlcToken`) + preimage store + Cashu wallet bindings | ✅ |
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

Each layer is pluggable. Swapping Cashu for Fedimint, or TLSNotary for another zkTLS provider, means implementing an adapter — the `EscrowProvider` interface (`src/application/escrow-port.ts`) already supports Cashu HTLC and FROST P2PK implementations.

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
deno task lint            # deno lint (recommended + no-eval / no-self-compare / default-param-last)
deno task lint:strict     # deno lint + arch + invariants + paths + refactor
deno task test:ci         # unit + protocol + all packages (CI pipeline)
deno task test:unit       # unit tests only
deno task test:packages   # workspace package tests only (each package in isolation)
deno task test:protocol   # protocol verification (trustless / attacks / exploits / quorum)
deno task test:frost      # FROST threshold signing
deno task test:regtest    # Cashu + Lightning E2E (Docker)
deno task test:pentest    # penetration tests
deno task test:example    # all 7 example apps
deno task test            # everything (including e2e)
```

See also: `deno task test:all` (deno lint + arch + invariants + paths + dep audit + unit + protocol + frost + integration + example + pentest), `deno task test:all:docker` (e2e relay + regtest with Docker), `deno task test:all:full` (all combined).

Current baseline: **312 unit/protocol/frost/example tests + 71 package tests / 0 failed**, deno lint clean, all 7 packages independently typecheck and test.

## API (host server)

<details>
<summary>Query Endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/queries` | Create query |
| `GET` | `/queries` | List open queries |
| `GET` | `/queries/all` | List all queries (auth required) |
| `GET` | `/queries/:id` | Query detail |
| `GET` | `/queries/:id/quotes` | List quotes for query |
| `POST` | `/queries/:id/quotes` | Worker submits quote |
| `POST` | `/queries/:id/select` | Select Worker |
| `POST` | `/queries/:id/begin` | Worker begins work |
| `POST` | `/queries/:id/result` | Submit proof + verify + settle |
| `POST` | `/queries/:id/cancel` | Cancel query |
| `POST` | `/queries/:id/upload` | Upload photo/media (auth required) |
| `GET` | `/queries/:id/attachments` | List attachments |
| `GET` | `/queries/:id/attachments/:index` | Get attachment (redirect) |
| `GET` | `/queries/:id/attachments/:index/meta` | Attachment metadata |
| `GET` | `/queries/:id/attachments/:index/preview` | Attachment preview image |
| `POST` | `/hash` | Oracle generates preimage/hash |
| `GET` | `/oracles` | List oracles |
| `GET` | `/health` | Health check |

</details>

<details>
<summary>Marketplace Endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/marketplace/listings` | List active data listings |
| `GET` | `/marketplace/listings/:id` | Get listing detail |
| `POST` | `/marketplace/listings` | Create listing (auth required) |
| `DELETE` | `/marketplace/listings/:id` | Deactivate listing (auth required) |
| `GET` | `/marketplace/data/:id` | Get purchase info (returns 402 with payment instructions) |
| `POST` | `/marketplace/data/:id` | Purchase data (X-Cashu or X-Cashu-Htlc header) |
| `POST` | `/marketplace/listings/:id/announce` | Announce listing on Nostr (auth required) |

</details>

<details>
<summary>Configuration</summary>

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` / `REFERENCE_APP_PORT` | Server port | `3000` |
| `HTTP_API_KEY` | API key for write endpoints | — |
| `HTTP_API_KEYS` | Comma-separated API keys (alternative) | — |
| `CASHU_MINT_URL` | Cashu mint URL | — |
| `NOSTR_RELAYS` | Relay WebSocket URLs | — |
| `BLOSSOM_SERVERS` | Blossom blob server URLs | — |
| `TLSN_VERIFIER_URL` | TLSNotary Verifier URL | — |
| `TLSN_PROXY_URL` | TLSNotary WebSocket proxy URL | — |
| `FROST_CONFIG_PATH` | FROST node config file | — |
| `TRUSTED_ORACLE_PUBKEYS` | Comma-separated Oracle pubkeys for whitelist | — |
| `ANTHROPIC_API_KEY` | Claude API key (for AI content check) | — |
| `AI_CONTENT_CHECK` | Enable AI content verification | `false` |
| `REMOTE_QUERY_API_BASE_URL` | Remote query backend URL | — |
| `REMOTE_QUERY_API_KEY` | Remote query backend API key | — |
| `QUERY_SWEEP_INTERVAL_MS` | Query cleanup interval (ms) | `30000` |
| `PREVIEW_MAX_DIMENSION` | Max preview image dimension (px) | `768` |
| `PREVIEW_JPEG_QUALITY` | JPEG preview quality (1-100) | `75` |
| `RUNTIME_DATA_DIR` | Local data directory | `.local` |
| `ANCHR_LOG_LEVEL` / `LOG_LEVEL` | logTape level (`debug` / `info` / `warning` / `error` / `fatal`) | `info` |

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

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE)
