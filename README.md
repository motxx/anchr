# Anchr

Decentralized marketplace for cryptographically verified data, paid with Bitcoin.

AI agents and humans buy verified API responses, price feeds, and real-world photos — with no trust required. Workers earn sats by proving what servers returned (TLSNotary) or what they saw (C2PA).

## SDK

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

## How It Works

**No trust required.** Proof is tied to the TLS certificate (web) or C2PA signature (photo) — if data is wrong, cryptographic verification fails. Payment is atomic via Cashu HTLC escrow: the Oracle holds a secret preimage, and only reveals it when verification passes, unlocking the bounty for the Worker.

### Protocol Sequence

```mermaid
sequenceDiagram
    participant R as Requester
    participant O as Oracle<br/>(Anchr Server)
    participant M as Cashu Mint
    participant N as Nostr Relay
    participant W as Worker
    participant V as TLSNotary<br/>Verifier
    participant T as Target Server
    participant B as Blossom

    Note over R,B: Phase 1 — Setup & Escrow

    R->>O: POST /hash
    Note right of O: Generate preimage (secret)<br/>Store in preimageStore
    O-->>R: hash = SHA256(preimage)

    R->>M: Mint ecash (pay Lightning invoice)
    M-->>R: Cashu Proof[] (e.g. 100 sats)

    R->>O: POST /queries (HTLC mode)
    Note right of R: description, bounty,<br/>HTLC{hash, locktime},<br/>verification_requirements,<br/>tlsn_requirements or GPS
    O-->>R: query_id (awaiting_quotes)
    Note right of O: WalletStore locks<br/>Requester's Proof[] for query

    R->>N: kind 5300 Job Request
    Note right of N: Broadcast to all Workers

    Note over R,B: Phase 2 — Worker Discovery & Selection

    N-->>W: Job Request received
    W->>O: POST /queries/:id/quotes
    Note right of W: worker_pubkey, amount_sats

    R->>O: POST /queries/:id/select
    Note right of R: worker_pubkey,<br/>htlc_token (Cashu HTLC)
    O->>M: checkProofsStates
    M-->>O: All proofs UNSPENT ✓
    O-->>R: status: processing

    R->>N: kind 7000 (NIP-44 encrypted → Worker)
    Note right of R: HTLC token + target details

    Note over R,B: Phase 3 — Proof Generation

    alt Web Data (TLSNotary)
        W->>V: MPC-TLS handshake
        W->>T: HTTPS request (co-signed session)
        T-->>W: HTTPS response
        V-->>W: .presentation.tlsn
    else Real-World Photo (C2PA)
        Note over W: Capture with C2PA camera<br/>(GPS + timestamp embedded)
    end

    W->>B: Upload AES-256-GCM encrypted blob
    B-->>W: Blossom URI + SHA256

    Note over R,B: Phase 4 — Verification & Settlement

    W->>O: POST /queries/:id/result
    Note right of W: proof (tlsn_presentation<br/>or photo attachments)

    alt TLSNotary
        Note over O: 1. Decode .presentation.tlsn<br/>2. Verify MPC-TLS signatures<br/>3. Extract server_name from TLS cert<br/>4. Evaluate conditions (jsonpath/regex)<br/>5. Check attestation freshness
    else C2PA + GPS
        Note over O: 1. Verify C2PA manifest signature<br/>2. Validate EXIF GPS + timestamp<br/>3. Check haversine distance ≤ max_km<br/>4. Challenge nonce (if required)
    end

    O-->>W: preimage + status: approved
    Note right of O: WalletStore transfers<br/>Proof[] → Worker

    W->>M: Redeem HTLC (preimage + signature)
    M-->>W: New unrestricted Proof[] (100 sats)

    Note over R,B: ✓ Requester has verified data<br/>✓ Worker earned sats<br/>✓ No party could cheat
```

### State Machine

```
awaiting_quotes → processing → verifying → approved  (preimage revealed, sats released)
                                         → rejected  (proofs refunded to Requester)
```

### Key Properties

- **Atomic payment**: Cashu HTLC locks funds — Worker can only redeem with the preimage, which Oracle only reveals on successful verification
- **Timeout refund**: If HTLC locktime expires, Requester reclaims the escrowed sats
- **Privacy**: Cashu blind signatures prevent Mint from linking token issuance to redemption; Nostr provides pseudonymous identity
- **Two proof types**: TLSNotary (web API data) and C2PA (real-world photos) — both cryptographically bound to source

## Two Verification Modes

### Web Data (TLSNotary)

Prove what any HTTPS server returned. Workers fetch the URL through a Multi-Party Computation TLS session — the Verifier Server co-signs the session without seeing the plaintext.

### Real-World Photos (C2PA)

Prove what a location looks like right now. Workers photograph with a C2PA-signed camera — the Content Credentials are cryptographically bound to the image, GPS, and timestamp.

## Use Cases

| Use case | Verification | Example |
|----------|-------------|---------|
| Price oracle (DeFi) | TLSNotary | Prove BTC/ETH price from CoinGecko, Binance |
| Flight status | TLSNotary | Prove flight delay for parametric insurance |
| API response proof | TLSNotary | Prove any HTTPS API returned specific data |
| Location check | C2PA + GPS | Photograph a store, intersection, event |
| Combined proof | Both | Photo of a price tag + API price verification |

## Quick Start

```bash
bun install
bun run infra:up                    # relay + blossom + verifier (docker)
bun run dev                         # server on :3000
```

Worker app (iOS / Android / Web):
```bash
cd mobile && bun install
bun run ios                         # or: bun run web
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
    "description": "渋谷スクランブル交差点の混雑状況",
    "expected_gps": {"lat": 35.6595, "lon": 139.7004},
    "max_gps_distance_km": 0.5,
    "bounty": {"amount_sats": 100}
  }'
```

<details>
<summary>Full endpoint list</summary>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hash` | Oracle generates preimage/hash pair |
| `POST` | `/queries` | Create query (HTLC mode) |
| `GET` | `/queries` | List open queries (`?lat=&lon=&max_distance_km=`) |
| `GET` | `/queries/all` | List all queries (any status) |
| `GET` | `/queries/:id` | Query detail |
| `POST` | `/queries/:id/quotes` | Worker submits quote |
| `POST` | `/queries/:id/select` | Select worker + verify HTLC token |
| `POST` | `/queries/:id/result` | Submit proof (inline verification → preimage) |
| `POST` | `/queries/:id/upload` | Upload photo (multipart) |
| `POST` | `/queries/:id/cancel` | Cancel query (refund proofs) |
| `GET` | `/queries/:id/attachments` | List attachments |
| `GET` | `/wallet/balance` | Wallet balance (`?role=&pubkey=&verify=true`) |
| `GET` | `/health` | Health check |
| `GET` | `/oracles` | List oracles |
| `GET` | `/logs/stream` | Server log stream (SSE) |

</details>

## MCP (AI Agent Integration)

Anchr exposes an MCP server so AI agents (Claude Desktop, Claude Code, etc.) can request cryptographically verified data.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anchr": {
      "command": "bun",
      "args": ["run", "/path/to/anchr/src/mcp.ts"],
      "env": {
        "REMOTE_QUERY_API_BASE_URL": "https://anchr-app.fly.dev"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add anchr -- bun run /path/to/anchr/src/mcp.ts
```

### Available tools

| Tool | Description |
|------|-------------|
| `create_query` | Request verified web data (TLSNotary) or real-world photos (C2PA) |
| `get_query_status` | Poll query status and retrieve verified results |
| `list_available_queries` | List open queries |
| `cancel_query` | Cancel a pending query |
| `get_query_attachment` | Get attachment URL/metadata |
| `get_query_attachment_preview` | Get resized preview image |

### Example: AI agent verifies BTC price

```
Human: "What is the current BTC price? I need a cryptographic proof."

Claude uses create_query:
  verification_requirements: ["tlsn"]
  target_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }]

→ Auto-worker fetches via MPC-TLS, generates cryptographic proof
→ Claude polls get_query_status, receives verified data
→ "BTC is $XX,XXX (cryptographically proven via TLSNotary — server: api.coingecko.com)"
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Requester                                 │
│  anchr.query({ targetUrl, conditions, sats })                    │
└────────────┬─────────────────────────────────┬───────────────────┘
             │ Nostr kind 5300                  │ Cashu Proof[]
             ▼                                  ▼
┌────────────────────┐                ┌─────────────────┐
│    Nostr Relay      │                │   Cashu Mint     │
│  (broadcast + DM)   │                │ (Lightning-backed)│
└────────────┬────────┘                └──────┬──────────┘
             │ kind 5300                       │ checkProofsStates
             ▼                                 │
┌──────────────────────────────────────────────┼───────────────────┐
│                        Worker                │                    │
│                                              │                    │
│  TLSNotary path:          Photo path:        │                    │
│    tlsn-prove               C2PA camera      │                    │
│      ↕ MPC-TLS                ↓              │                    │
│    Verifier Server          Upload + GPS     │                    │
│      ↓                        ↓              │                    │
│    .presentation.tlsn       C2PA manifest    │                    │
│              ↓                 ↓             │                    │
│              └── Blossom (E2E encrypted) ────┘                    │
└────────────┬─────────────────────────────────────────────────────┘
             │ POST /queries/:id/result
             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Oracle (Anchr Server)                         │
│                                                                   │
│  TLSNotary: tlsn-verifier → MPC-TLS signature verify             │
│  C2PA: c2patool → Content Credentials signature verify            │
│  Conditions: jsonpath / regex / GPS haversine / nonce challenge   │
│                                                                   │
│  ✓ Pass → reveal preimage → Cashu HTLC bounty → Worker           │
│  ✗ Fail → refund Proof[] → Requester                             │
└──────────────────────────────────────────────────────────────────┘
```

## Configuration

| Variable | Description |
|----------|-------------|
| `NOSTR_RELAYS` | Relay WebSocket URLs (comma-separated) |
| `BLOSSOM_SERVERS` | Blossom blob server URLs |
| `CASHU_MINT_URL` | Cashu mint for ecash payments |
| `HTTP_API_KEY` | API key for write endpoints |
| `TLSN_VERIFIER_URL` | TLSNotary Verifier Server URL |
| `TLSN_PROXY_URL` | TLSNotary WebSocket proxy URL |

## Testing

```bash
bun test                         # all tests
bun test src/                    # unit tests
bun test e2e/tlsn.test.ts       # TLSNotary E2E (real MPC-TLS)
bun test e2e/tlsn-browser.test.ts  # browser extension E2E
bun run test:regtest             # Lightning + Cashu E2E
```

## Stack

| Layer | Tech |
|-------|------|
| SDK | TypeScript (`anchr-sdk`) |
| Server | Bun + Hono |
| Messaging | Nostr (NIP-90 DVM) |
| Storage | Blossom (E2E encrypted) |
| Payment | Cashu ecash (NUT-14 HTLC) / Lightning |
| Web Verification | TLSNotary (MPC-TLS + Rust verifier) |
| Photo Verification | C2PA + EXIF + ProofMode + GPS |
| TLS Verifier Server | Rust (async-tungstenite + WsStream) |
| Mobile | React Native (Expo) + NativeWind |

## License

[MIT](LICENSE)
