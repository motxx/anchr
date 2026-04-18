# Anchr Protocol

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)

Anchr is a protocol for atomically exchanging cryptographic proofs and Bitcoin payments without a trusted third party.

A Requester posts a bounty. A Worker produces a cryptographic proof (TLSNotary for web data, C2PA for photos). An Oracle verifies the proof. Payment releases only when verification passes.

- Requester can't revoke payment (sats locked in escrow before work begins) — see [INV-03](docs/threat-model.md#inv-03-requester-cant-unlock-escrow-before-timeout)
- Worker can't forge proofs (verification is cryptographic) — see [INV-01](docs/threat-model.md#inv-01-worker-cant-forge-tlsn-proofs)
- Oracle can't steal funds (escrow requires Worker's signature to redeem) — see [INV-02](docs/threat-model.md#inv-02-oracle-cant-release-preimage-without-valid-proof)
- For high-value queries, t-of-n independent Oracles verify via FROST threshold signing

## Architecture

| Layer | Implementation | Role |
|-------|---------------|------|
| Payment | Cashu (NUT-11 P2PK, NUT-14 HTLC) | Escrow + atomic settlement |
| Web Verification | TLSNotary (MPC-TLS) | Prove HTTPS responses |
| Photo Verification | C2PA + GPS | Prove real-world captures |
| Messaging | Nostr (NIP-90 DVM) | Broadcast queries, deliver results |
| Storage | Blossom (AES-256-GCM) | E2E encrypted blob storage |
| Threshold Signing | FROST (BIP-340 Schnorr) | Multi-Oracle consensus |

Each layer is pluggable. Swapping Cashu for Fedimint, or TLSNotary for another zkTLS provider, means implementing an adapter.

## Protocol Flow

```
Requester → lock escrow → post query (Nostr)
                                ↓
Worker discovers → produces proof (TLSNotary/C2PA)
                                ↓
Oracle verifies → reveals preimage or FROST signature
                                ↓
Worker redeems at Cashu Mint → Requester gets verified data
                                ↓
            timeout? → escrow refunds to Requester
```

## Examples

| Example | Description |
|---------|-------------|
| [Prediction Market](example/prediction-market/) | Binary outcome market with FROST P2PK + Cashu HTLC |
| [Airdrop Bot Shield](example/airdrop-bot-shield/) | TLSNotary Sybil resistance without identity linkage |
| [Auto-Claim](example/auto-claim/) | Browser extension that detects and claims owed money automatically |
| [C2PA Media Verification](example/c2pa-media-verification/) | Prove a photo is a real capture, not AI-generated |
| [Supply Chain Proof](example/supply-chain-proof/) | GPS + C2PA + TLSNotary tamper-proof records |
| [Fiat Swap](example/tlsn-fiat-swap-square/) | TLSNotary-proved fiat payment to Bitcoin atomic swap |
| [Bounty Board](example/bounty-board/) | Web UI for bounty queries |

## Quick Start

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
deno task test:ci         # unit + protocol (CI pipeline)
deno task test:regtest    # Cashu + Lightning E2E (Docker)
deno task test:frost      # FROST threshold signing
deno task test            # everything
```

## API

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

</details>

## Specifications

Protocol specs in [`specs/`](specs/). Released under CC0 (public domain). Anyone may implement them.

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE)
