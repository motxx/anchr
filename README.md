# Anchr

Anonymous real-world information protocol on [Nostr](https://nostr.com/), paid with [Cashu](https://cashu.space/) ecash.

Requesters post queries (photo proof, store status). Anonymous workers fulfill them on the ground. A minimal oracle verifies C2PA authenticity; workers receive ecash automatically on pass via HTLC.

## Design Principles

- **Pull-based**: Requesters specify what they want. Workers respond.
- **Anonymous**: No accounts, no identities. Nostr keypairs only.
- **Trustless payment**: Cashu HTLC escrow — funds release automatically on C2PA verification, refund on timeout.
- **Minimal oracle**: Oracle generates HTLC preimage at query creation, verifies C2PA authenticity, and delivers preimage to Worker on pass. No content judgment.

> Future: Oracle can be replaced entirely by Cairo Spending Conditions (ZK-based) once the ecosystem matures.

## How It Works

```mermaid
sequenceDiagram
    participant R as Requester
    participant O as Oracle
    participant N as Nostr Relay
    participant W as Worker
    participant B as Blossom
    participant M as Cashu Mint

    R->>O: request hash for new query
    O->>O: generate preimage, store secretly
    O->>R: return hash(preimage) only

    Note over R: hold Cashu proofs locally<br/>(plain bearer tokens, no conditions yet)
    R->>N: DVM Job Request (kind 5300)<br/>Requester pubkey + Oracle pubkey included

    W->>N: subscribe and pick up query
    W->>W: verify Oracle pubkey in Job Request<br/>against trusted Oracle whitelist → drop out if unknown
    W->>N: quote (kind 7000 status=payment-required)<br/>Worker pubkey included
    O->>N: listen for kind 7000 quotes → record Worker pubkey

    R->>N: listen and receive quotes (possibly multiple Workers)
    R->>R: select one Worker based on quote
    R->>M: swap HTLC to add selected Worker pubkey<br/>condition: hash(preimage) AND Worker signature
    R->>N: announce selection (kind 7000 status=processing)<br/>selected Worker pubkey included
    O->>M: check HTLC condition → record selected Worker pubkey

    loop all Workers watching Nostr
        W->>N: watch for kind 7000 status=processing
        alt own pubkey listed in announcement
            W->>M: verify own pubkey is in HTLC condition
            alt HTLC confirmed
                M->>W: own pubkey confirmed → proceed
            else HTLC mismatch
                M->>W: pubkey not in HTLC → drop out (Requester lied)
            end
        else another pubkey listed
            N->>W: another pubkey listed → drop out
        end
    end

    W->>W: photograph on-site<br/>C2PA signed + EXIF strip
    W->>W: generate symmetric key K<br/>encrypt blob with K (AES-256-GCM)<br/>encrypt K with Requester pubkey → K_R<br/>encrypt K with Oracle pubkey → K_O
    W->>B: upload encrypted blob
    W->>N: DVM Job Result (kind 6300)<br/>Blossom URL + blob hash + K_R + K_O

    R->>N: listen and receive result (Blossom URL + K_R)
    R->>B: download encrypted blob
    R->>R: decrypt K_R with Requester privkey → K<br/>decrypt blob with K + verify C2PA + view result

    O->>N: listen and receive result (Blossom URL + K_O)
    O->>O: verify kind 6300 pubkey = selected Worker pubkey (from HTLC)<br/>verify kind 6300 references correct Job Request ID<br/>reject if mismatch → ignore event
    O->>B: download encrypted blob
    O->>O: verify blob hash matches Nostr event<br/>decrypt K_O with Oracle privkey → K<br/>decrypt blob with K + verify C2PA signature
    alt C2PA valid
        O->>N: send preimage via NIP-44 DM (kind 4) signed by Oracle privkey
        W->>N: receive DM
        W->>W: verify sender pubkey = Oracle pubkey in Job Request
        W->>M: redeem token with preimage + Worker signature
    else C2PA invalid
        O->>N: send rejection via NIP-44 DM (kind 4) signed by Oracle privkey
        W->>N: receive rejection
        W->>W: verify sender pubkey = Oracle pubkey in Job Request → stop waiting
        Note over M,R: timelock expires → Cashu refunds Requester automatically
    end
```

**Oracle cannot steal funds**: the HTLC requires both `hash(preimage)` AND the Worker's signature (NUT-14 `pubkeys` tag). Oracle alone cannot redeem — it knows the preimage but not the Worker's private key.

**Payment is trustless**: The Requester holds plain Cashu proofs locally until a Worker is selected. On selection, plain proofs are swapped for a Cashu HTLC token (NUT-14) locked to `hash(preimage) AND Worker pubkey`. Plain proofs are used in Phase 1 because the Requester does not know the preimage — the Mint requires it to spend hashlock-ed proofs. Oracle delivers the preimage to Worker via NIP-44 DM (kind 4) on C2PA pass. Timeout refunds the requester automatically via the `refund` tag (NUT-11).


## Architecture

```mermaid
graph TB
    subgraph Actors["Actors"]
        direction LR
        Requester["Requester<br/>(HTTP / SDK)"]
        Worker["Worker<br/>(Worker UI / SDK)"]
        Oracle["Oracle<br/>(preimage + C2PA + delivery)"]
    end

    subgraph Bus["Nostr Relay Network — Message Bus"]
        direction LR
        K5300["kind 5300<br/>Job Request"]
        K7000["kind 7000<br/>Feedback"]
        K6300["kind 6300<br/>Job Result"]
    end

    subgraph Infra["Infrastructure"]
        direction LR
        Cashu["Cashu Mint<br/>HTLC escrow (NUT-14)"]
        Blossom["Blossom<br/>AES-256-GCM blob store"]
    end

    Actors --> Bus
    Requester -->|"lock / swap HTLC"| Cashu
    Worker -->|"verify / redeem HTLC"| Cashu
    Oracle -->|"check HTLC condition"| Cashu
    Worker -->|"upload encrypted blob"| Blossom
    Oracle -->|"download blob for C2PA"| Blossom
```

## Payment Flow

| Step | Actor | Action |
|------|-------|--------|
| 1 | Requester | Ask Oracle for hash (Oracle generates preimage secretly, returns hash only) |
| 2 | Requester | Hold plain Cashu proofs locally (bearer tokens, no HTLC conditions yet) |
| 3 | Requester | Post DVM Job Request (kind 5300) with Oracle pubkey |
| 4 | Worker | Pick up query, verify Oracle pubkey against whitelist |
| 5 | Worker | Send quote (kind 7000 status=payment-required) with Worker pubkey |
| 6 | Requester | Select Worker, swap HTLC to add Worker pubkey |
| 7 | Requester | Announce selection (kind 7000 status=processing) |
| 8 | Oracle | Confirm selected Worker pubkey via HTLC |
| 9 | Worker | Confirm own pubkey in HTLC, photograph, encrypt with KEM+DEM, upload to Blossom |
| 10 | Worker | Post DVM Job Result (kind 6300) with Blossom URL + blob hash + K_R + K_O |
| 11 | Oracle | Verify Worker identity, download blob, verify blob hash, verify C2PA |
| 12 | Oracle | Send preimage via NIP-44 DM (kind 4) signed by Oracle privkey |
| 13 | Worker | Verify Oracle pubkey in DM, redeem HTLC with preimage + Worker signature |
| 14 (fallback) | Requester | Reclaim token automatically after timelock if no valid submission |

**Why Oracle cannot steal**: Oracle knows the preimage but not the Worker's private key. Both are required to redeem — neither party can act alone.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3+
- [Docker](https://www.docker.com/) (for local relay & Blossom)

### Install & Demo

```bash
git clone https://github.com/motxx/anchr.git
cd anchr
bun install
bun run demo    # starts local relay + Blossom, runs full lifecycle
```

### Run

```bash
bun run start           # HTTP + worker UI
bun run dev             # with file watching

# with local infrastructure
bun run infra:up
NOSTR_RELAYS=ws://localhost:7777 BLOSSOM_SERVERS=http://localhost:3333 bun run start
```

### Test

```bash
bun run test            # unit + integration
bun run test:e2e        # E2E (starts docker compose)
bun run test:all        # all
```

## Usage

### HTTP API

Write endpoints require `Authorization: Bearer <key>` when `HTTP_API_KEY` is set.

<details>
<summary>Endpoints</summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/oracles` | List registered oracles |
| `GET` | `/queries` | List open queries |
| `GET` | `/queries/:id` | Query detail |
| `POST` | `/queries` | Create query |
| `POST` | `/queries/:id/upload` | Upload attachment |
| `POST` | `/queries/:id/submit` | Submit result |
| `POST` | `/queries/:id/cancel` | Cancel query |
| `GET` | `/queries/:id/attachments` | List attachments |
| `GET` | `/queries/:id/attachments/:index` | Serve attachment |
| `GET` | `/queries/:id/attachments/:index/meta` | Attachment metadata |
| `GET` | `/queries/:id/attachments/:index/preview` | Resized preview |
| `GET` | `/queries/:id/quotes` | List worker quotes (HTLC) |
| `POST` | `/queries/:id/quotes` | Submit worker quote (HTLC) |
| `POST` | `/queries/:id/select` | Select worker (HTLC) |
| `POST` | `/queries/:id/result` | Submit worker result (HTLC) |

</details>

### SDK

```ts
import { createQuery, queryTemplates } from "anchr";

// Requester: create a query (fetches HTLC hash from Oracle internally)
const query = await createQuery(
  queryTemplates.photoProof("Shibuya crossing, Tokyo"),
  {
    ttlSeconds: 3600,
    oraclePubkey: "npub1...",   // trusted Oracle pubkey
    cashuMintUrl: "https://mint.example.com",
  },
);

// query.htlcToken  — locked Cashu HTLC token
// query.nostrEventId — kind 5300 Job Request ID
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REFERENCE_APP_PORT` | `3000` | HTTP server port |
| `NOSTR_RELAYS` | -- | Comma-separated relay WebSocket URLs |
| `BLOSSOM_SERVERS` | -- | Comma-separated Blossom server URLs |
| `HTTP_API_KEY` | -- | API key for write endpoints |
| `CASHU_MINT_URL` | -- | Cashu mint URL for ecash payments |
| `ORACLE_PORT` | `4000` | Oracle server port |
| `ORACLE_API_KEY` | -- | Oracle server authentication |
| `TRUSTED_ORACLE_PUBKEYS` | -- | Comma-separated pubkeys of trusted Oracles (Worker whitelist) |

## Deployment

Four Fly.io apps are deployed via CI/CD:

```mermaid
graph LR
    subgraph Fly.io
        Relay["anchr-relay<br/>nostr-rs-relay<br/>wss://anchr-relay.fly.dev"]
        Blossom["anchr-blossom<br/>blossom-server<br/>https://anchr-blossom.fly.dev"]
        App["anchr<br/>Bun app<br/>https://anchr.fly.dev"]
        Oracle["anchr-oracle<br/>Bun app<br/>https://anchr-oracle.fly.dev"]
    end

    App -->|NOSTR_RELAYS| Relay
    App -->|BLOSSOM_SERVERS| Blossom
    Oracle -->|NOSTR_RELAYS| Relay
    Oracle -->|BLOSSOM_SERVERS| Blossom
```

```mermaid
graph TD
    Push["push to main"] --> CI["CI<br/>typecheck + test + build"]
    CI --> Infra["Deploy Infrastructure (parallel)"]
    Infra --> R["anchr-relay"]
    Infra --> B["anchr-blossom"]
    R --> Deploy["Deploy anchr"]
    R --> DeployOracle["Deploy anchr-oracle"]
    B --> Deploy
    B --> DeployOracle
```

### Initial Setup

```bash
fly apps create anchr-relay
fly volumes create relay_data --app anchr-relay --region nrt --size 1

fly apps create anchr-blossom
fly volumes create blossom_data --app anchr-blossom --region nrt --size 1

fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region nrt
fly secrets set HTTP_API_KEY=...
```

Set `FLY_API_TOKEN` as a GitHub Actions secret. Pushes to main auto-deploy all four apps.

## Roadmap

- [ ] Oracle fee: two-HTLC design for trustless Worker+Oracle fee distribution (currently Oracle runs free)
- [ ] Oracle discovery: NIP-89 (kind 31990) registration for decentralized Oracle registry — replaces hardcoded whitelist, enables multiple competing Oracles and graceful failover
- [ ] Oracle → Cairo Spending Conditions (trustless C2PA verification via ZK)
- [ ] Worker reputation layer
- [ ] AI-assisted query decomposition (for non-Diaspora requesters)

## License

[MIT](LICENSE)