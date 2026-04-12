# Anchr Protocol

[![CI](https://github.com/motxx/anchr/actions/workflows/ci.yml/badge.svg)](https://github.com/motxx/anchr/actions/workflows/ci.yml)

A trustless protocol for exchanging payments and secret data.

Anchr verifies that data is authentic before releasing payment — no trusted intermediary required. The protocol is designed to be agnostic to the payment layer, oracle type, and messaging transport. Today it runs on Cashu, TLSNotary/C2PA, and Nostr. Tomorrow it could run on anything.

## What It Does

A Requester posts a bounty: "prove what this server returned" or "photograph this location." A Worker fulfills the request. An Oracle verifies the proof cryptographically. Payment is released only when verification passes.

No party can cheat. The Requester can't revoke payment after work begins. The Worker can't forge proofs. The Oracle can't steal the funds. This is enforced by cryptography, not policy.

```typescript
import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "https://anchr-app.fly.dev" });

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

## Protocol Design: Agnostic by Default

Anchr separates concerns into pluggable layers. Each layer has a current implementation, but the protocol does not depend on it.

| Layer | Role | Current Implementation | Swappable? |
|-------|------|----------------------|------------|
| **Payment** | Escrow + atomic settlement | Cashu (NUT-11 P2PK, NUT-14 HTLC) | Yes — any escrow with hashlock or multisig |
| **Oracle** | Verify proofs, release payment | TLSNotary (web), C2PA (photos) | Yes — any deterministic verification |
| **Messaging** | Broadcast queries, deliver results | Nostr (NIP-90 DVM) | Yes — any pub/sub with encryption |
| **Storage** | Store encrypted blobs | Blossom | Yes — any content-addressed storage |
| **Threshold Signing** | Multi-Oracle consensus | FROST (BIP-340 Schnorr) | Yes — any threshold signature scheme |

### Why Agnostic?

Payment rails change. Verification methods evolve. Communication protocols come and go. Anchr's security guarantees come from the protocol structure (escrow + verification + atomic settlement), not from any specific technology choice. Binding to one stack would limit adoption and create single points of failure.

## Security Model

### Single Oracle (default)

One Oracle verifies and releases payment. Simple, fast, and sufficient when the Oracle is trusted.

**Guarantees (Cashu NUT-11 + NUT-14):**
- Oracle cannot steal BTC — HTLC requires Worker's signature
- Worker cannot redeem without valid proof — Oracle holds preimage
- Requester cannot revoke — sats locked before work begins
- Timeout refund — automatic return after locktime expires

**Trust assumption:** The Oracle is honest. If it isn't, it can approve garbage (Requester loses) or reject valid work (Worker loses).

### Threshold Oracle (t-of-n)

Multiple independent Oracles each verify the same proof. Payment requires t-of-n approvals via FROST threshold signing. No single Oracle can decide alone.

```typescript
// Requester chooses 2-of-3 independent Oracle verification
const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "...",
  oracleIds: ["anchr", "community-oracle-a", "community-oracle-b"],
  quorum: { min_approvals: 2 },
  maxSats: 21,
});
```

**How it works:**
1. Each Oracle independently runs the same deterministic verification
2. Oracles that pass produce a FROST signature share
3. Oracles that fail refuse to sign — no share produced
4. When t shares are collected, a BIP-340 Schnorr group signature is formed
5. Worker redeems with the group signature + their own key

**Security properties:**
- A single malicious Oracle cannot approve garbage (needs t-1 colluders)
- A single malicious Oracle cannot block valid work (t-1 honest Oracles suffice)
- Requester and Worker are not signers — only neutral Oracle operators participate
- Verification is deterministic — honest Oracles always agree on the same input

**Residual risks:**
- t colluding Oracles can approve anything (mitigation: increase n, diversify operators)
- All Oracles run the same code — a verification bug affects everyone (mitigation: open-source, auditable)
- Cashu Mint is trusted for token issuance and spending condition enforcement

### Choosing a Mode

| Scenario | Mode | Config |
|----------|------|--------|
| Trusted Oracle operator | Single | `oracleIds: ["anchr"]` (default) |
| High-value queries | 2-of-3 | `oracleIds: [...], quorum: { min_approvals: 2 }` |
| Maximum security | 3-of-5 | `oracleIds: [...], quorum: { min_approvals: 3 }` |

No code changes required — the Requester specifies oracle_ids and quorum at query creation time.

## Protocol Flow

```mermaid
sequenceDiagram
    participant R as Requester
    participant O as Oracle(s)
    participant M as Cashu Mint
    participant W as Worker
    participant V as TLSNotary Verifier
    participant T as Target Server

    R->>O: get hash(preimage)
    R->>M: create escrow token<br/>condition: hash(preimage) AND Worker sig
    R->>W: send escrow token + query

    Note over O,M: Oracle has preimage but not Worker's key<br/>→ cannot redeem

    W->>V: MPC-TLS handshake (joint key shares)
    W->>T: HTTPS request (co-signed TLS session)
    T-->>W: HTTPS response
    V-->>W: .presentation.tlsn

    Note over W,V: Worker sees plaintext but can't alter it<br/>(Verifier holds independent key share)

    W->>O: submit .presentation.tlsn
    O->>O: verify independently

    alt Single Oracle: verification passed
        O->>W: reveal preimage
        W->>M: redeem (preimage + Worker sig)
    else Threshold Oracle: t-of-n passed
        O->>O: FROST signing (round 1 + round 2)
        O->>W: deliver group signature
        W->>M: redeem (group sig + Worker sig)
    else verification failed
        Note over O,W: Oracle withholds preimage / refuses to sign
    end

    Note over R,M: timeout → escrow refunds to Requester
```

<details>
<summary>Detailed Protocol Sequence</summary>

```mermaid
sequenceDiagram
    participant R as Requester
    participant O as Oracle(s)
    participant N as Nostr Relay
    participant W as Worker
    participant V as TLSNotary Verifier
    participant B as Blossom
    participant M as Cashu Mint

    R->>O: request hash for new query
    O->>O: generate preimage, store secretly
    O->>R: return hash(preimage) only

    Note over R: hold Cashu proofs locally<br/>(plain bearer tokens, no conditions yet)
    R->>N: DVM Job Request (kind 5300)<br/>oracle_ids + quorum config included

    W->>N: subscribe and discover query
    W->>W: verify Oracle pubkeys against trusted whitelist
    W->>N: quote (kind 7000 status=payment-required)

    R->>R: select Worker from quotes
    R->>M: swap to add Worker pubkey in escrow condition
    R->>N: announce selection (kind 7000 status=processing)

    W->>M: verify own pubkey in escrow condition → proceed

    alt Web Data (TLSNotary)
        W->>V: MPC-TLS handshake
        W->>W: HTTPS request via co-signed TLS session
        V-->>W: .presentation.tlsn
    else Real-World Photo (C2PA)
        W->>W: photograph on-site (C2PA signed + EXIF stripped)
    end

    W->>W: encrypt blob (AES-256-GCM)<br/>encrypt key to Requester (K_R) + Oracle (K_O)
    W->>B: upload encrypted blob
    W->>N: DVM Job Result (kind 6300)

    O->>B: download + decrypt blob
    O->>O: verify proof independently

    alt Single Oracle mode
        O->>W: preimage via NIP-44 DM
        W->>M: redeem (preimage + Worker sig)
    else Threshold Oracle mode
        O->>O: coordinate FROST signing across peers
        O->>W: group signature via NIP-44 DM
        W->>M: redeem (group sig + Worker sig)
    end

    Note over R,M: locktime expires → Cashu refunds Requester
```

### State Machine

```
awaiting_quotes → processing → verifying → approved  (payment released)
                                         → rejected  (refunded to Requester)
```

</details>

## Verification Modes

### Web Data — TLSNotary

Prove what any HTTPS server returned. Workers fetch the URL through a Multi-Party Computation TLS session. The Verifier Server co-signs the session without seeing the plaintext. The Worker cannot alter the response.

### Real-World Photos — C2PA

Prove what a location looks like right now. Workers photograph with a C2PA-signed camera. Content Credentials are cryptographically bound to the image, GPS coordinates, and timestamp.

| Use Case | Verification | Example |
|----------|-------------|---------|
| Price oracle (DeFi) | TLSNotary | BTC/ETH price from CoinGecko, Binance |
| Flight status (insurance) | TLSNotary | Flight delay proof for parametric claims |
| API response proof | TLSNotary | Any HTTPS API returned specific data |
| Location check | C2PA + GPS | Photograph a store, intersection, event |
| Combined proof | Both | Photo of a price tag + API price verification |

## Quick Start

```bash
deno install                         # install dependencies
deno task build:ui                   # build frontend
deno task dev                        # server on :3000
```

FROST Oracle cluster (optional):
```bash
cd crates/frost-signer && cargo build --release
deno run --allow-all scripts/frost-dkg-bootstrap.ts    # generate keys
deno run --allow-all scripts/frost-oracle-cluster.ts   # start 3 Oracles
```

## API

```bash
# Web data query (TLSNotary)
curl -X POST localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "BTC price from CoinGecko",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      "conditions": [{"type": "jsonpath", "expression": "bitcoin.usd"}]
    },
    "bounty": {"amount_sats": 21}
  }'

# Photo query (C2PA)
curl -X POST localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Shibuya Scramble crossing congestion",
    "expected_gps": {"lat": 35.6595, "lon": 139.7004},
    "max_gps_distance_km": 0.5,
    "bounty": {"amount_sats": 100}
  }'

# Threshold Oracle query (2-of-3)
curl -X POST localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{
    "description": "ETH price from Binance",
    "verification_requirements": ["tlsn"],
    "tlsn_requirements": {
      "target_url": "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      "conditions": [{"type": "jsonpath", "expression": "price"}]
    },
    "bounty": {"amount_sats": 50},
    "oracle_ids": ["anchr", "oracle-a", "oracle-b"],
    "quorum": {"min_approvals": 2}
  }'
```

<details>
<summary>Full endpoint list</summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hash` | Oracle generates preimage/hash pair |
| `POST` | `/queries` | Create query |
| `GET` | `/queries` | List open queries (`?lat=&lon=&max_distance_km=`) |
| `GET` | `/queries/all` | List all queries (any status) |
| `GET` | `/queries/:id` | Query detail |
| `POST` | `/queries/:id/quotes` | Worker submits quote |
| `POST` | `/queries/:id/select` | Select Worker + verify escrow |
| `POST` | `/queries/:id/result` | Submit proof (verification + settlement) |
| `POST` | `/queries/:id/upload` | Upload photo (multipart) |
| `POST` | `/queries/:id/cancel` | Cancel query |
| `GET` | `/queries/:id/attachments` | List attachments |
| `GET` | `/wallet/balance` | Wallet balance |
| `GET` | `/health` | Health check |
| `GET` | `/oracles` | List oracles |
| `POST` | `/frost/dkg/init` | Start FROST DKG session |
| `POST` | `/frost/sign/:queryId` | Start FROST signing session |
| `GET` | `/frost/sign/:queryId` | Signing session status |

</details>

## MCP (AI Agent Integration)

AI agents can request cryptographically verified data via MCP.

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "anchr": {
      "command": "deno",
      "args": ["run", "--allow-all", "/path/to/anchr/src/mcp.ts"],
      "env": {
        "REMOTE_QUERY_API_BASE_URL": "https://anchr-app.fly.dev"
      }
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `create_query` | Request verified web data or real-world photos |
| `get_query_status` | Poll status and retrieve verified results |
| `list_available_queries` | List open queries |
| `cancel_query` | Cancel a pending query |
| `get_query_attachment` | Get attachment URL/metadata |

## Testing

```bash
deno task test:unit       # domain + app + infra unit tests (140 suites)
deno task test:protocol   # security property tests (24 suites)
deno task test:frost      # FROST unit + CLI + HTTP + E2E (12 suites)
deno task test:e2e:frost  # FROST threshold E2E only
deno task test:regtest    # Lightning + Cashu E2E (requires Docker)
deno task test:ci         # unit + protocol (matches CI pipeline)
deno task test            # everything
```

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                         Requester                                  │
│  anchr.query({ targetUrl, conditions, sats, oracleIds, quorum })  │
└────────────┬──────────────────────────────────┬───────────────────┘
             │ Nostr kind 5300                   │ Escrow Token
             ▼                                   ▼
┌────────────────────┐                 ┌─────────────────┐
│   Messaging Layer   │                 │  Payment Layer   │
│  (Nostr Relay)      │                 │  (Cashu Mint)    │
└────────────┬────────┘                 └──────┬──────────┘
             │                                  │
             ▼                                  │
┌───────────────────────────────────────────────┼───────────────────┐
│                         Worker                │                    │
│                                               │                    │
│  TLSNotary path:          Photo path:         │                    │
│    MPC-TLS session          C2PA camera       │                    │
│      ↕                        ↓               │                    │
│    Verifier Server          GPS + EXIF        │                    │
│      ↓                        ↓               │                    │
│    .presentation.tlsn       C2PA manifest     │                    │
│              ↓                 ↓              │                    │
│              └── Storage (Blossom, E2E enc) ──┘                    │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Oracle Layer                                    │
│                                                                    │
│  Single Oracle         │  Threshold Oracle (t-of-n)                │
│    verify()            │    each peer: verify() → sign share       │
│    → preimage          │    aggregate → FROST group signature      │
│                                                                    │
│  TLSNotary: tlsn-verifier (Rust sidecar)                          │
│  C2PA: c2patool → Content Credentials                              │
│  FROST: frost-signer (Rust sidecar, BIP-340 Schnorr)              │
└───────────────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Current Implementation |
|-------|----------------------|
| Runtime | Deno |
| HTTP | Hono |
| Messaging | Nostr (NIP-90 DVM, NIP-44 encryption) |
| Storage | Blossom (E2E encrypted, AES-256-GCM) |
| Payment | Cashu ecash (NUT-11 P2PK + NUT-14 HTLC) |
| Web Verification | TLSNotary (MPC-TLS, Rust verifier sidecar) |
| Photo Verification | C2PA + EXIF + ProofMode + GPS |
| Threshold Signing | FROST secp256k1 (Rust sidecar, BIP-340) |
| SDK | TypeScript (`anchr-sdk`) |

## Roadmap

Anchr's agnostic design enables expansion across all protocol layers.

| Layer | Current | Planned |
|-------|---------|---------|
| **Payment** | Cashu HTLC | DLC (Discreet Log Contracts) on Bitcoin L1, Lightning HODL invoices |
| **Oracle** | TLSNotary, C2PA | zkTLS, TEE attestations, zkProofs |
| **Messaging** | Nostr | HTTP-only mode, libp2p |
| **Threshold** | FROST (BIP-340) | MuSig2, ROAST |
| **Storage** | Blossom | IPFS, Arweave |

### DLC Integration

Anchr Oracles already produce deterministic attestations — the same structure DLC contracts consume. A DLC adapter would allow:

- **Bitcoin L1 escrow**: Lock BTC in a DLC output instead of Cashu. Oracle attestation directly unlocks the contract.
- **No Mint trust**: Removes the Cashu Mint as a trust assumption entirely.
- **Composability**: Anchr attestations become reusable DLC oracle feeds for any contract.

The Oracle's `verify()` → attestation pipeline is already DLC-compatible. The missing piece is a `DlcEscrowProvider` that implements the `EscrowProvider` interface using DLC outputs instead of Cashu tokens.

## Configuration

| Variable | Description |
|----------|-------------|
| `NOSTR_RELAYS` | Relay WebSocket URLs (comma-separated) |
| `BLOSSOM_SERVERS` | Blossom blob server URLs |
| `CASHU_MINT_URL` | Cashu mint for ecash payments |
| `HTTP_API_KEY` | API key for write endpoints |
| `TLSN_VERIFIER_URL` | TLSNotary Verifier Server URL |
| `FROST_CONFIG_PATH` | FROST node config file (from DKG bootstrap) |
| `ORACLE_PORT` | Oracle server port (default: 4000) |
| `ORACLE_API_KEY` | Oracle server API key |

## License

[MIT](LICENSE)
