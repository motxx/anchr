# Anchr Protocol

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)

Atomic swap of verifiable data and Bitcoin — without a trusted third party.

```typescript
const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
  maxSats: 21,
});

result.verified;    // true — cryptographically proven
result.data;        // { bitcoin: { usd: 71000 } }
result.serverName;  // "api.coingecko.com" — from TLS certificate
result.proof;       // TLSNotary presentation (independently verifiable)
```

## How It Works

A **Requester** posts a bounty. A **Worker** fulfills it by producing a cryptographic proof (TLSNotary for web data, C2PA for photos). An **Oracle** verifies the proof. Payment is released only when verification passes.

No party can cheat:
- Requester can't revoke payment (sats locked in escrow before work begins)
- Worker can't forge proofs (verification is cryptographic)
- Oracle can't steal funds (escrow requires Worker's signature to redeem)

For high-value queries, multiple independent Oracles verify via [FROST threshold signing](specs/04-threshold-oracle.md) — no single Oracle can decide alone.

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

## Architecture

| Layer | Current | Role |
|-------|---------|------|
| Payment | Cashu (NUT-11 P2PK, NUT-14 HTLC) | Escrow + atomic settlement |
| Web Verification | TLSNotary (MPC-TLS) | Prove HTTPS responses |
| Photo Verification | C2PA + GPS | Prove real-world captures |
| Messaging | Nostr (NIP-90 DVM) | Broadcast queries, deliver results |
| Storage | Blossom (AES-256-GCM) | E2E encrypted blob storage |
| Threshold Signing | FROST (BIP-340 Schnorr) | Multi-Oracle consensus |

Each layer is pluggable. Swapping Cashu for Fedimint, or TLSNotary for another zkTLS provider, means implementing an adapter — not changing the protocol.

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

See [`specs/`](specs/) for the full protocol specification.

## Examples

| Example | What it demonstrates |
|---------|---------------------|
| [Prediction Market](example/prediction-market/) | Non-custodial betting with FROST P2PK + Cashu HTLC + Nostr |
| [Airdrop Bot Shield](example/airdrop-bot-shield/) | TLSNotary Sybil resistance — prove you're human, stay anonymous |
| [Auto-Claim](example/auto-claim/) | Automatic money recovery via browser extension |
| [C2PA Media Verification](example/c2pa-media-verification/) | Prove a photo is real, not AI-generated |
| [Supply Chain Proof](example/supply-chain-proof/) | Tamper-proof records with GPS + C2PA + TLSNotary |
| [Fiat Swap](example/tlsn-fiat-swap-square/) | TLSNotary-proved fiat payment → Bitcoin atomic swap |
| [Bounty Board](example/bounty-board/) | Web UI for bounty queries |

## MCP (AI Agent Integration)

```json
{
  "mcpServers": {
    "anchr": {
      "command": "deno",
      "args": ["run", "--allow-all", "/path/to/anchr/src/mcp.ts"]
    }
  }
}
```

Tools: `create_query`, `get_query_status`, `list_available_queries`, `cancel_query`, `get_query_attachment`

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
| `POST` | `/queries/:id/select` | Select Worker (→ worker_selected) |
| `POST` | `/queries/:id/begin` | Worker begins work (→ processing) |
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

Protocol specs in [`specs/`](specs/) — CC0 (public domain). Anyone may implement them.

## License

Code: [MIT](LICENSE) · Specs: [CC0](specs/LICENSE)
