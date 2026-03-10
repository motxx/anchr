# Anchr

> Anonymous, censorship-resistant real-world verification.

Anchr connects requesters (AI agents, apps, humans) with anonymous reporters who provide first-hand evidence — photos, observations, field data. Results are verified by deterministic oracles and paid via [Cashu](https://cashu.space/) ecash over [Nostr](https://nostr.com/).

**No KYC. No identity. Just facts and payment.**

## How It Works

```
Requester                 Nostr Relay              Worker                    Oracle
    |                         |                       |                        |
    | 1. DVM Job Request      |                       |                        |
    |    (kind 5300, tagged    |                       |                        |
    |     "anchr" + Cashu      |                       |                        |
    |     P2PK escrow token)   |                       |                        |
    |------------------------>|                       |                        |
    |                         |  2. pick up query     |                        |
    |                         |---------------------->|                        |
    |                         |                       |                        |
    |                         |                       | 3. do the work:        |
    |                         |                       |    photograph, observe  |
    |                         |                       |    EXIF strip → encrypt |
    |                         |                       |    → upload to Blossom  |
    |                         |                       |                        |
    |                         |  4. DVM Job Result    |                        |
    |                         |     (kind 6300,       |                        |
    |                         |      NIP-44 encrypted)|                        |
    |                         |<----------------------|                        |
    |                         |                       |                        |
    | 5. receive response     |                       |                        |
    |<------------------------|                       |                        |
    |                         |                       |                        |
    |                         |  6. OracleAttestation |                        |
    |                         |     (kind 30103,      |                        |
    |                         |      plaintext)       |                        |
    |                         |<-----------------------------------------------|
    |                         |                       |                        |
    | 7. DVM Job Feedback     |                       |                        |
    |    (kind 7000, Cashu    |                       |                        |
    |     token inside)       |                       |                        |
    |------------------------>|                       |                        |
    |                         |  8. worker redeems    |                        |
    |                         |     Cashu token       |                        |
    |                         |---------------------->|                        |
```

**Oracle selection is mutual**: the requester specifies acceptable oracles; the worker picks one. This prevents collusion from either side. Verification is deterministic — anyone can reproduce the checks and prove if an oracle lied.

**Payment is anonymous**: Cashu ecash tokens are locked with P2PK (NUT-11) 2-of-2 multisig (Oracle + Worker). On verification pass, the oracle co-signs a swap — worker gets the bounty minus fee. On failure, the token times out and the requester reclaims it. No Lightning invoices, no identity.

## Features

- **NIP-90 DVM compatible** — standard Nostr Data Vending Machine event kinds (5300/6300/7000)
- **Three query types** — photo proof, store status, webpage field extraction
- **Oracle-verified** — deterministic checks (C2PA, EXIF, GPS, attachments) with mutual oracle selection
- **Privacy-first** — EXIF stripping, Cashu ecash, NIP-44 encryption, ephemeral identities
- **Blossom storage** — content-addressed, AES-256-GCM encrypted blob storage
- **MCP integration** — use as tools in Claude Desktop or any MCP-compatible client
- **HTTP API** — create queries, upload attachments, submit results, poll status
- **Reference worker app** — browser UI for reporters to pick up and fulfill queries

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3+

### Install

```bash
git clone https://github.com/motxx/anchr.git
cd anchr
bun install
```

### Run

```bash
# Full service (MCP + HTTP + worker UI)
bun run start

# HTTP only
bun run start:http

# Development with watch
bun run dev
```

The worker app is available at `http://localhost:3000`.

### Test

```bash
bun test
```

## Usage

### As an SDK

```ts
import {
  createQuery,
  getQuery,
  submitQueryResult,
  listOracles,
  queryTemplates,
} from "anchr";

const query = createQuery(
  queryTemplates.storeStatus("Ramen Jiro Shinjuku", "Tokyo"),
  { ttlSeconds: 300, oracleIds: ["built-in"] },
);

const result = await submitQueryResult(query.id, {
  type: "store_status",
  status: "open",
}, {
  executor_type: "human",
  channel: "worker_api",
}, "built-in");
```

### As MCP Tools (Claude Desktop)

Add to your MCP config:

```json
{
  "mcpServers": {
    "anchr": {
      "command": "bun",
      "args": ["run", "/path/to/anchr/src/index.ts"]
    }
  }
}
```

Available tools:

| Tool | Description |
|------|-------------|
| `request_photo_proof` | Request photo evidence of a real-world target |
| `request_store_status` | Check if a place is open or closed |
| `request_webpage_field` | Extract a specific field from a webpage |
| `get_query_status` | Poll query status and results |
| `submit_query_result` | Submit a result for a pending query |
| `cancel_query` | Cancel a pending query |
| `list_available_queries` | List queries waiting for reporters |
| `get_query_attachment` | Get attachment URL/metadata |
| `get_query_attachment_preview` | Get a resized preview image |

To proxy through a remote deployment, set `REMOTE_QUERY_API_BASE_URL` and `REMOTE_QUERY_API_KEY` in the MCP env.

### Nostr-Native Mode

When `NOSTR_RELAYS` and `NOSTR_NATIVE=true` are set, Anchr operates without a central server:

- Queries are published as DVM Job Requests (kind 5300) tagged `["t", "anchr"]`
- Workers subscribe to relays, pick up jobs, and respond with DVM Job Results (kind 6300)
- Oracle attestations are published as kind 30103 (plaintext, publicly verifiable)
- Settlement happens via DVM Job Feedback (kind 7000) with Cashu tokens
- All messages between requester and worker are NIP-44 encrypted
- Each query uses an ephemeral keypair — no identity persistence

```bash
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol NOSTR_NATIVE=true bun run start
```

### HTTP API

Write endpoints require `Authorization: Bearer <key>` or `X-API-Key` header when `HTTP_API_KEY` is set.

```bash
# Create a query
curl -X POST http://localhost:3000/queries \
  -H "Content-Type: application/json" \
  -d '{"type": "photo_proof", "target": "Storefront sign", "ttl_seconds": 600}'

# List open queries
curl http://localhost:3000/queries

# Get query detail
curl http://localhost:3000/queries/$QUERY_ID

# Submit a result
curl -X POST http://localhost:3000/queries/$QUERY_ID/submit \
  -H "Content-Type: application/json" \
  -d '{"type": "photo_proof", "attachments": [...], "oracle_id": "built-in"}'

# List available oracles
curl http://localhost:3000/oracles
```

<details>
<summary>Full endpoint reference</summary>

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/oracles` | List available oracles |
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

</details>

## Query Types

| Type | Input | Output | Checks |
|------|-------|--------|--------|
| `photo_proof` | target, location_hint | photos, text_answer | Attachment presence, EXIF, C2PA, AI content (opt-in) |
| `store_status` | store_name, location_hint | `"open"`/`"closed"`, optional photo | Status validity, photo evidence |
| `webpage_field` | url, field, anchor_word | answer, proof_text | Anchor word match, answer presence |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REFERENCE_APP_PORT` | `3000` | HTTP server port |
| `DB_PATH` | `.local/queries.db` | SQLite database path |
| `HTTP_API_KEY` | — | API key for write endpoints |
| `HTTP_API_KEYS` | — | Comma-separated API keys |
| `AI_CONTENT_CHECK` | `false` | Enable AI content check (`true`/`1`) |
| `ANTHROPIC_API_KEY` | — | Required when AI check is enabled |
| `ATTACHMENT_STORAGE` | `local` | `local`, `s3`, `r2`, or `localstack` |
| `REMOTE_QUERY_API_BASE_URL` | — | Remote backend for MCP proxy mode |
| `NOSTR_RELAYS` | — | Comma-separated Nostr relay URLs |
| `NOSTR_NATIVE` | `false` | Use Nostr as sole data layer (no SQLite) |
| `CASHU_MINT_URL` | — | Cashu mint URL for ecash payments |
| `BLOSSOM_SERVERS` | — | Comma-separated Blossom server URLs |
| `ORACLE_PORT` | `4000` | Standalone oracle server port |
| `ORACLE_API_KEY` | — | Oracle server authentication |

<details>
<summary>S3 / R2 / LocalStack variables</summary>

| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | Generic S3-compatible storage |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 |
| `LOCALSTACK_ENDPOINT`, `LOCALSTACK_BUCKET`, `LOCALSTACK_PUBLIC_BASE_URL` | LocalStack for local dev |

</details>

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Nostr Relay Network                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │kind 5300 │  │kind 6300 │  │kind 30103 │  │kind 7000  │ │
│  │Job Req   │  │Job Result│  │Attestation│  │Feedback   │ │
│  └──────────┘  └──────────┘  └───────────┘  └───────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
   │Requester│   │  Worker   │  │ Oracle  │
   │         │   │           │  │         │
   │ MCP /   │   │ Worker UI │  │Built-in │
   │ HTTP /  │   │ or SDK    │  │or HTTP  │
   │ SDK     │   │           │  │(Tor OK) │
   └────┬────┘   └─────┬─────┘  └─────────┘
        │              │
        │         ┌────▼────┐
        │         │ Blossom │  content-addressed
        │         │ Storage │  AES-256-GCM encrypted
        │         └─────────┘
        │
   ┌────▼──────────┐
   │ Cashu Mint    │  anonymous ecash
   │ (Lightning)   │  P2PK escrow (NUT-11)
   └───────────────┘
```

Three backend modes:

1. **Local** (default) — SQLite + optional Nostr broadcast
2. **Remote** — HTTP proxy via `REMOTE_QUERY_API_BASE_URL`
3. **Nostr-native** — `NOSTR_RELAYS` + `NOSTR_NATIVE=true`, no central server

## Project Structure

```
src/
  index.ts              SDK entrypoint
  query-service.ts      query lifecycle (SQLite-backed)
  types.ts              shared types
  nostr/
    events.ts           DVM event builders (kind 5300/6300/7000)
    oracle-attestation.ts  kind 30103 attestation events
    encryption.ts       NIP-44 + region-key encryption
    identity.ts         ephemeral Nostr keypairs
    client.ts           relay pool (publish, subscribe, fetch)
    query-bridge.ts     connects QueryService ↔ Nostr relays
    nostr-query-service.ts  full Nostr-native lifecycle
  oracle/
    built-in.ts         deterministic verification logic
    oracle-server.ts    standalone HTTP oracle (Tor-compatible)
    http-oracle.ts      HTTP oracle client
    registry.ts         oracle discovery + mutual selection
  cashu/
    wallet.ts           Cashu mint/redeem/verify
    escrow.ts           P2PK 2-of-2 multisig + timelock refund
  blossom/
    client.ts           Blossom download + decrypt
    worker-upload.ts    EXIF strip → encrypt → upload
    fetch-attachment.ts attachment fetcher for oracle verification
  verification/         EXIF, C2PA, AI content checks
  worker-api.ts         HTTP API (Hono)
  mcp-server.ts         MCP stdio adapter
  mcp-query-backend.ts  backend mode selector (local/remote/nostr)
  ui/                   reference worker app (React)
```

## Deployment

### Fly.io

```bash
fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region nrt
fly secrets set HTTP_API_KEY=... ATTACHMENT_STORAGE=r2 R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_PUBLIC_BASE_URL=...
fly deploy
```

### CI/CD

GitHub Actions runs typecheck, tests, and Docker build on every push. Merges to main auto-deploy to Fly.io. Requires `FLY_API_TOKEN` secret.

## Roadmap

- [x] EXIF stripping, C2PA validation, AI content check
- [x] Nostr protocol layer (NIP-44 encryption, relay client)
- [x] NIP-90 DVM event kinds (5300/6300/7000)
- [x] Oracle system with mutual selection
- [x] Standalone oracle HTTP server (Tor-compatible)
- [x] Cashu P2PK escrow (NUT-11 2-of-2 multisig + timelock refund)
- [x] Worker-side Blossom storage (EXIF strip + AES-256-GCM + upload)
- [x] Nostr-native mode (no central server dependency)
- [ ] Umbrel app packaging

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
bun install
bun test
bun run typecheck
```

## License

[MIT](LICENSE)
