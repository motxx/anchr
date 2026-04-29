# Anchr

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Specs: CC0](https://img.shields.io/badge/Specs-CC0-green.svg)](specs/LICENSE)

**Buy cryptographically verified data with sats. No middleman holds your money.**

When you buy data online today, you have to trust the seller — that the
number came from the claimed source, that they didn't tamper with it on
the way, that they won't take your money and disappear. Every API key,
every paid feed, every "we promise this is real" notice is a stand-in
for that trust.

Anchr replaces it. The seller produces a proof you can check yourself,
and the Bitcoin escrow only releases against that proof. The buyer
can't take the data without paying. The seller can't get paid without
producing a verifiable answer. Nobody in the middle can pocket the
money.

The reference server runs at
[`anchr-app.fly.dev`](https://anchr-app.fly.dev/health); the wire
specs are CC0 so anyone can implement an alternative.

## How it works

Three actors. One Bitcoin escrow. One message bus. Four steps.
Equivalently: **NIP-90 (Nostr DVM) + Cashu HTLC settlement + Oracle-verified proofs.**

```
Requester ─ locks escrow ──► posts query
                                      │
                                      ▼
Worker   ─ discovers ──────► produces proof
                                      │
                                      ▼
Oracle   ─ verifies ───────► releases escrow
                                      │
                                      ▼
Worker   ─ redeems ────────► Requester gets the data

                                      timeout? ─► escrow refunds
```

1. **Requester** posts a query and locks payment in a Cashu HTLC.
2. **Worker** discovers the query over Nostr (NIP-90 DVM), gathers the
   data, and either generates a cryptographic proof (TLSNotary on
   HTTPS responses) or relays an attestation produced upstream by a
   signing device (C2PA from a hardware-signed camera, ProofMode from
   an attested mobile capture). GPS coordinates inside a C2PA EXIF
   assertion are verified within the same proof.
3. **Oracle** verifies the proof. If valid, it releases the HTLC
   preimage; for high-value queries, t-of-n independent oracles each
   sign in parallel via FROST and a single party can't release alone.
4. **Worker** redeems the Cashu token at the mint and the requester
   receives the verified result. If anything fails, the locktime
   refunds the requester.

Three properties hold without trusting any single party: requesters
can't revoke payment once work has begun; workers can't forge proofs
because verification is cryptographic; oracles can't steal funds
because the escrow only releases against the worker's own signature.
An attack test pins each property — see
[`docs/threat-model.md`](docs/threat-model.md) for the full
enumeration.

## Use it

Three independent paths.

### As a library

```typescript
import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "https://anchr-app.fly.dev" });

const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
  maxSats: 21,
});

console.log(result.verified);   // true
console.log(result.data);       // { bitcoin: { usd: 71000 } }
console.log(result.serverName); // "api.coingecko.com" — TLS session cryptographically bound to this server name (does not assert the data is "true")
console.log(result.proof);      // base64 TLSNotary presentation, independently verifiable
```

Install: `bun add anchr-sdk` (or `npm i anchr-sdk`).

### As a server

```bash
deno install
deno task build:ui && deno task build:css
deno task dev                  # http://localhost:3000
```

Full local stack (regtest Bitcoin + Cashu mint + Nostr relay + Blossom)
in Docker — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

### As a contributor

`./scripts/test-all.sh --local` runs the same gate as CI. Test
commands and the quality bar live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Built with it

Seven examples under [`example/`](example/) — five runnable, two
conceptual sketches. All are exercised in CI.

| Example | What it shows |
|---|---|
| [Prediction market (Kannagi)](example/prediction-market/) ([live](https://anchr-market.fly.dev)) | Bilateral binary bets matched 1:1 via cross-lock, non-custodial payouts settled by oracle attestation. |
| [Auto-claim](example/auto-claim/) | "Install the extension. Browse normally. Money you're owed comes back automatically." |
| [Airdrop bot shield (Katashiro)](example/airdrop-bot-shield/) | TLSNotary-based Sybil resistance for token airdrops — proves Web2 attributes without persisting the underlying credential. |
| [Fiat ↔ BTC swap (Watari)](example/tlsn-fiat-swap-square/) | Counterparty proves a Square card payment via TLSNotary; the Cashu HTLC releases BTC against that proof. |
| [C2PA photo verification](example/c2pa-media-verification/) | News desks pay sats for photos that carry hardware-signed Content Credentials (camera, timestamp, GPS) plus an AI-generation heuristic. |
| [Royalty distribution](example/royalty-distribution/) | Conceptual sketch: recursive R/W/O across the edges of a content rights graph — every payment gated on verifiable proof, every distribution publicly auditable. The verification-only chain pattern at its cleanest (no physical-binding gap). |
| [Supply-chain proof](example/supply-chain-proof/) | Conceptual sketch: same verification-only chain pattern in the *physical* domain. Demonstrates Anchr's value as well as its limit (the photo-to-shipment binding gap). |

## The pieces

Anchr is **independently usable packages**. Most users only need the
canonical composition above — but each piece can be picked up
standalone for other patterns:

| Package | Purpose | Used by |
|---|---|---|
| [`packages/photo-bounty`](packages/photo-bounty/) | C2PA + GPS + ProofMode + EXIF + AI heuristic | c2pa-media, supply-chain |
| [`packages/tlsn-toolkit`](packages/tlsn-toolkit/) | TLSNotary verification (replay-protected, ReDoS-safe) | auto-claim, airdrop, fiat-swap, supply-chain |
| [`packages/cashu-conditional-swap`](packages/cashu-conditional-swap/) | Bilateral cross-lock for binary outcomes (HTLC + FROST P2PK) | prediction-market, fiat-swap, auto-claim, airdrop |
| [`packages/cashu-frost-oracle`](packages/cashu-frost-oracle/) | FROST t-of-n threshold signing wrapper | prediction-market |
| [`packages/core-cashu`](packages/core-cashu/) | Cashu HTLC escrow + preimage store | (used by conditional-swap) |
| [`packages/core-runtime`](packages/core-runtime/) | Bun ↔ Deno compatibility helpers | (used by host server) |
| [`packages/sdk`](packages/sdk/) | High-level HTTP / MCP client for the canonical bounty flow | c2pa-media, auto-claim, fiat-swap |

Plus Rust crates (`crates/frost-signer`, `crates/tlsn-*`) for the
underlying primitives. See [`docs/architecture.md`](docs/architecture.md)
for layer dependencies and composition patterns.

## Other compositions

The bounty flow is the canonical use, but Anchr's packages can be
combined differently:

- **Bilateral market** ([`prediction-market`](example/prediction-market/)) — two counterparties cross-lock at the Mint, an Oracle reveals the winning outcome via preimage or FROST signature. *No external data fetch — the bettors are the data source.* Uses `cashu-conditional-swap` + `cashu-frost-oracle` directly, no SDK.
- **Verification-only chain** ([`supply-chain-proof`](example/supply-chain-proof/)) — multi-hop evidence chain using `photo-bounty` + `tlsn-toolkit` only. *No Cashu HTLC — settlement is off-protocol (typically fiat invoices).* Anchr's value here is the verifiable evidence chain, not the BTC flow.

Detail in [`docs/architecture.md`](docs/architecture.md).

## Reference

<details>
<summary>HTTP API — query / oracle endpoints</summary>

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
| `POST` | `/queries/:id/upload` | Upload media (auth required) |
| `GET` | `/queries/:id/attachments` | List attachments |
| `POST` | `/hash` | Oracle generates preimage / hash |
| `GET` | `/oracles` | List oracles |
| `GET` | `/health` | Health check |

</details>

<details>
<summary>HTTP API — marketplace endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/marketplace/listings` | List active data listings |
| `POST` | `/marketplace/listings` | Create listing (auth required) |
| `GET` | `/marketplace/data/:id` | Purchase info (HTTP 402) |
| `POST` | `/marketplace/data/:id` | Buy data (X-Cashu / X-Cashu-Htlc) |

</details>

<details>
<summary>Configuration (env)</summary>

| Variable | Default |
|---|---|
| `PORT` / `REFERENCE_APP_PORT` | `3000` |
| `HTTP_API_KEYS` (comma-separated) | — |
| `CASHU_MINT_URL` | — |
| `NOSTR_RELAYS` | — |
| `BLOSSOM_SERVERS` | — |
| `TLSN_VERIFIER_URL` / `TLSN_PROXY_URL` | — |
| `FROST_CONFIG_PATH` | — |
| `TRUSTED_ORACLE_PUBKEYS` | — |
| `ANTHROPIC_API_KEY` (for AI content check) | — |
| `ANCHR_LOG_LEVEL` (`debug`/`info`/`warning`/`error`) | `info` |
| `RUNTIME_DATA_DIR` | `.local` |

</details>

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE) — anyone may
implement them.
