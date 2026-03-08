# human-calling-mcp

> A compact SDK/service for turning unindexed real-world questions into live human queries.

`human-calling-mcp` is a small query engine for questions that AI cannot answer from training data, web search, or APIs alone.

Examples:
- "Is this ramen shop open right now?"
- "What does the paper notice on that door say?"
- "What price is shown on the in-store menu today?"
- "Does this thing physically exist at this location right now?"

The core idea is simple:

```text
AI or app asks a live query
  -> a human in the real world answers it
  -> lightweight verification runs
  -> a structured result comes back
```

The package has three layers:
- `SDK core`: create queries, track state, collect results, run verification
- `MCP adapter`: exposes the query engine as MCP tools
- `Reference worker app`: a browser UI that consumes the same engine

Payment, privacy policy, worker reputation, and routing marketplaces are intentionally out of scope for the core.

## Core Use Case

This is for **real-time, real-world fact retrieval**.

Use it when:
- the answer depends on what is true right now
- the answer is not indexed on the internet
- the answer requires physical presence or direct observation
- an AI agent needs a structured human fallback

Do not treat it as:
- a generic gig-work platform
- a long-running workflow engine
- a proof-of-truth system
- a bundled payment network

## Quick Start

**1. Install**

```bash
bun install
```

**2. Run the reference service**

```bash
bun run src/server.ts
```

This starts:
- the MCP stdio adapter
- the reference worker app on `http://localhost:3000`
- the local SQLite-backed query store

**3. Add the MCP adapter to Claude Desktop**

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "human-calling": {
      "command": "bun",
      "args": ["run", "/path/to/human-calling-mcp/src/server.ts"],
      "env": {
        "REFERENCE_APP_PORT": "3000"
      }
    }
  }
}
```

Then ask something like:

> "I need to know whether the ramen shop near Tokyo Station is open right now. Use the live human query tool."

## SDK

The package root now exports a compact query-first API.

```ts
import {
  type AttachmentRef,
  createQuery,
  getQuery,
  listOpenQueries,
  queryTemplates,
  submitQueryResult,
} from "human-calling-mcp";

const query = createQuery(
  queryTemplates.storeStatus("Ramen Jiro Shinjuku", "near Tokyo"),
  { ttlSeconds: 300 },
);

const openQueries = listOpenQueries();
const latest = getQuery(query.id);

submitQueryResult(query.id, {
  type: "store_status",
  status: "open",
  notes: "Front sign says open. K7P4",
}, {
  executor_type: "human",
  channel: "worker_api",
});
```

### Exported SDK Surface

- `createQuery(input, options?)`
- `createQueryService(store?)`
- `getDefaultQueryService()`
- `getQuery(id)`
- `listOpenQueries()`
- `submitQueryResult(id, result, submissionMeta)`
- `cancelQuery(id)`
- `expireQueries()`
- `queryTemplates.photoProof(...)`
- `queryTemplates.storeStatus(...)`
- `queryTemplates.webpageField(...)`
- `verifyQueryResult(query, result)`
- `startMcpAdapter()`
- `startReferenceWorkerApi()`

## Query Templates

The current SDK ships with three narrow templates.

### `store_status`

Structured answer for "open now or closed now" questions.

Worker returns:
- `status: "open" | "closed"`
- `notes`: must include the nonce

### `photo_proof`

Structured answer for "go look and photograph this" questions.

Worker returns:
- `text_answer`: must include the nonce
- `attachments: AttachmentRef[]`: at least one uploaded image reference
- `notes`: optional

### `webpage_field`

Structured answer for "a human must read this page and extract a field" questions.

Worker returns:
- `answer`
- `proof_text`: text near the anchor word
- `notes`: must include the nonce

These templates are intentionally concrete. The core engine is small enough that other query types can be added later.

## Reference App

The browser UI is a **reference implementation**, not the product boundary.

Open:

```text
http://localhost:3000
```

It shows pending live queries and lets a human submit structured results.

Reference HTTP endpoints:
- `GET /queries`
- `GET /queries/:id`
- `POST /queries/:id/upload`
- `POST /queries/:id/submit`
- `POST /queries/:id/cancel`

For `photo_proof` queries:
- `POST /queries/:id/upload` returns `attachment`
- `GET /queries/:id` returns `result.attachments` as `AttachmentRef[]` with accessible `uri` values
- `GET /uploads/:filename` serves the uploaded image itself
- `get_query_attachment` returns URL/path metadata by default, and can inline small images through MCP with `include_image: true`

## MCP Adapter

The bundled MCP adapter exposes the engine as tools.

Current tools:
- `request_photo_proof`
- `request_store_status`
- `request_webpage_field`
- `get_query_status`
- `get_query_attachment`
- `cancel_query`
- `list_available_queries`
- `submit_query_result`

## Attachment Storage

The default attachment backend is local disk plus the reference app's `/uploads/...` HTTP route.

You can also switch to an S3-compatible object store so photo attachments are retrievable via public URLs.

Recommended:
- Cloudflare R2 with a custom domain

Also supported:
- Amazon S3 with CloudFront
- any S3-compatible endpoint that supports server-side PUT uploads

In S3 mode, uploaded files are written directly to object storage and `result.attachments` stores `AttachmentRef` objects whose `uri` points at the public asset URL.

For Claude Desktop, the MCP server still runs locally over `stdio`. A good deployment split is:
- local Bun process for the MCP adapter
- Cloudflare R2 for attachment storage
- optional custom domain such as `https://assets.example.com`

## Verification Model

Verification is intentionally lightweight.

Today it checks things like:
- nonce presence
- required fields
- simple structural constraints
- proof text for webpage extraction
- photo attachment presence for photo proof

This helps reject obviously bad submissions, but it does not prove ground truth.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REFERENCE_APP_PORT` | `3000` | Port for the reference worker app |
| `DB_PATH` | `queries.db` | SQLite path for the local query store |
| `ATTACHMENT_STORAGE` | `local` | Attachment backend: `local` or `s3` |
| `ATTACHMENT_PUBLIC_BASE_URL` | unset | Public base URL for local attachment links |
| `PUBLIC_BASE_URL` | unset | Alias used when local attachment URLs should resolve through a reverse proxy |
| `R2_ACCOUNT_ID` | unset | Cloudflare account ID; used to derive the R2 endpoint when `R2_ENDPOINT` is not set |
| `R2_BUCKET` | unset | R2 bucket name |
| `R2_ACCESS_KEY_ID` | unset | R2 access key |
| `R2_SECRET_ACCESS_KEY` | unset | R2 secret key |
| `R2_SESSION_TOKEN` | unset | Optional token for temporary R2 credentials |
| `R2_ENDPOINT` | unset | Optional explicit R2 API endpoint |
| `R2_PUBLIC_BASE_URL` | unset | Public read URL base, usually an R2 custom domain |
| `R2_REGION` | `auto` | Region value for R2 uploads |
| `R2_PREFIX` | unset | Optional key prefix inside the R2 bucket |
| `S3_ENDPOINT` | unset | S3-compatible API endpoint, e.g. R2 or S3 |
| `S3_BUCKET` | unset | Bucket name for S3-compatible uploads |
| `S3_REGION` | `auto` | S3 region; R2 commonly uses `auto` |
| `S3_ACCESS_KEY_ID` | unset | Access key for S3-compatible uploads |
| `S3_SECRET_ACCESS_KEY` | unset | Secret key for S3-compatible uploads |
| `S3_SESSION_TOKEN` | unset | Optional session token for temporary credentials |
| `S3_PUBLIC_BASE_URL` | unset | Public read URL base, e.g. a CloudFront or R2 custom domain |
| `S3_PREFIX` | unset | Optional prefix for uploaded object keys |

### Cloudflare R2 Example

```bash
ATTACHMENT_STORAGE=r2
R2_ACCOUNT_ID=your-account-id
R2_BUCKET=human-calling
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://assets.example.com
```

## Architecture

```text
src/
  index.ts          SDK entrypoint
  server.ts         reference runtime entrypoint
  query-service.ts  query-first SDK surface
  mcp-server.ts     MCP adapter
  worker-api.ts     reference worker app + HTTP API
  verification.ts   lightweight verification rules
  challenge.ts      nonce generation + challenge text
  db.ts             SQLite store
  types.ts          shared internal types
  ui/               reference app assets
```

## Design Boundary

The core should stay small and composable.

Keep in core:
- query creation
- query status
- result submission
- verification
- storage
- adapter hooks

Push out of core:
- payments
- worker discovery marketplaces
- privacy policy enforcement
- identity and reputation systems
- advanced routing logic

## Roadmap

- [ ] add a claim step so executors can explicitly accept a query
- [ ] expose richer executor metadata
- [ ] support webhooks in addition to polling
- [ ] add a transport-neutral adapter layer for A2A/A2H-style protocols
- [ ] generalize beyond the three built-in templates without bloating the core

## License

MIT
