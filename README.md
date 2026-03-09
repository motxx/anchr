# Anchr

> Anonymous, censorship-resistant ground truth verification.

Anchr is a protocol that connects requesters (AI agents, apps, humans) with anonymous reporters who provide real-world evidence — photos, observations, field data. Results are verified by deterministic oracles and paid via [Cashu](https://cashu.space/) ecash.

**No KYC. No identity. Just facts and payment.**

## Features

- **Three query types** — photo proof, store status, webpage field extraction
- **Oracle-verified** — deterministic checks (C2PA, EXIF, GPS, attachments) with mutual oracle selection
- **Privacy-first** — EXIF stripping, Cashu ecash payments, Nostr relay encryption, ephemeral identities
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

## How It Works

```
Requester                     Worker                      Oracle
    |                            |                           |
    |  1. create query           |                           |
    |  (type, params, bounty,    |                           |
    |   acceptable oracle_ids)   |                           |
    |                            |                           |
    |         2. pick up query, do the work                  |
    |                            |                           |
    |                            |  3. submit evidence       |
    |                            |     + select oracle_id    |
    |                            |------------------------>  |
    |                            |                           |
    |                            |  4. deterministic verify  |
    |                            |     (C2PA, EXIF, GPS...)  |
    |                            |                           |
    |                            |  5. attestation           |
    |                            |  <-----------------------  |
    |                            |                           |
    |  6. result + attestation   |                           |
    |  <-------------------------|                           |
```

**Oracle selection is mutual**: the requester specifies which oracles they accept; the worker picks one. This prevents collusion from either side. Verification is deterministic — anyone can reproduce the checks and prove if an oracle lied.

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

<details>
<summary>S3 / R2 / LocalStack variables</summary>

| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | Generic S3-compatible storage |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 |
| `LOCALSTACK_ENDPOINT`, `LOCALSTACK_BUCKET`, `LOCALSTACK_PUBLIC_BASE_URL` | LocalStack for local dev |

</details>

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

## Project Structure

```
src/
  index.ts              SDK entrypoint
  query-service.ts      query lifecycle
  types.ts              shared types
  oracle/               oracle interface, built-in oracle, registry
  verification/         deterministic checks (EXIF, C2PA, AI content)
  nostr/                Nostr protocol layer (NIP-44, events, relay)
  cashu/                Cashu ecash payments
  blossom/              content-addressed blob storage
  worker-api.ts         HTTP API (Hono)
  mcp-server.ts         MCP stdio adapter
  ui/                   reference worker app (React)
```

## Roadmap

- [x] Deterministic oracle verification with mutual selection
- [ ] Cashu P2PK payment escrow
- [ ] Direct worker-to-oracle HTTP endpoint (Tor-compatible)
- [ ] Nostr-native serverless protocol
- [ ] Worker claim step
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
