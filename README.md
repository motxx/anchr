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

For the browser app plus LocalStack attachment storage as one local environment:

```bash
bun run local:up
```

Stop it with:

```bash
bun run local:down
```

For an HTTP-only runtime without the local MCP stdio adapter:

```bash
bun run start:http
```

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
- `startReferenceApp()`
- `buildReferenceWorkerApi()`
- `prepareWorkerApiAssets()`

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
- `GET /queries/:id/attachments`
- `GET /queries/:id/attachments/:index`
- `GET /queries/:id/attachments/:index/meta`
- `GET /queries/:id/attachments/:index/preview`
- `POST /queries/:id/upload`
- `POST /queries/:id/submit`
- `POST /queries/:id/cancel`

For `photo_proof` queries:
- `POST /queries/:id/upload` returns `attachment`
- `GET /queries/:id` returns `result.attachments` as `AttachmentRef[]` with accessible `uri` values
- `GET /queries/:id/attachments/:index` returns the file itself for local storage, or redirects to the external object URL
- `GET /queries/:id/attachments/:index/meta` returns stable metadata and view URLs for browser or agent inspection
- `GET /queries/:id/attachments/:index/preview` returns a resized JPEG preview for browser or agent inspection
- `GET /uploads/:filename` serves the uploaded image itself
- `get_query_attachment` returns URL/path metadata only
- `get_query_attachment_preview` returns a resized preview image through MCP

## MCP Adapter

The bundled MCP adapter exposes the engine as tools.

Current tools:
- `request_photo_proof`
- `request_store_status`
- `request_webpage_field`
- `get_query_status`
- `get_query_attachment`
- `get_query_attachment_preview`
- `cancel_query`
- `list_available_queries`
- `submit_query_result`

## Attachment Storage

The default attachment backend is `.local/uploads` on disk plus a local mock object-access layer exposed by the reference app.

For local development, prefer the query attachment endpoints over wiring up a full S3 clone:
- `GET /queries/:id/attachments`
- `GET /queries/:id/attachments/:index`
- `GET /queries/:id/attachments/:index/meta`

You can also switch to an S3-compatible object store so photo attachments are retrievable via public URLs.

Recommended:
- Cloudflare R2 with a custom domain

Also supported:
- LocalStack S3 for local object-storage development
- Amazon S3 with CloudFront
- any S3-compatible endpoint that supports server-side PUT uploads
- Local mock mode via the reference app HTTP endpoints

In S3 mode, uploaded files are written directly to object storage and `result.attachments` stores `AttachmentRef` objects whose `uri` points at the public asset URL. In local mode, the same queries expose stable attachment view/meta URLs through the reference app.

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
| `DB_PATH` | `.local/queries.db` | SQLite path for the local query store |
| `QUERY_SWEEP_INTERVAL_MS` | `30000` | Interval for expiring stale pending queries |
| `PREVIEW_MAX_DIMENSION` | `768` | Max width/height for resized preview images |
| `PREVIEW_JPEG_QUALITY` | `75` | JPEG quality used when generating preview images |
| `ATTACHMENT_STORAGE` | `local` | Attachment backend: `local`, `localstack`, `r2`, or `s3` |
| `ATTACHMENT_PUBLIC_BASE_URL` | unset | Public base URL for local attachment links |
| `PUBLIC_BASE_URL` | unset | Alias used when local attachment URLs should resolve through a reverse proxy |
| `LOCALSTACK_ENDPOINT` | `http://localhost:4566` | LocalStack S3 endpoint |
| `LOCALSTACK_BUCKET` | `human-calling` | Bucket name used in LocalStack mode |
| `LOCALSTACK_PUBLIC_BASE_URL` | `http://localhost:4566/<bucket>` | Public read URL base for LocalStack mode |
| `LOCALSTACK_ACCESS_KEY_ID` | `test` | Access key used in LocalStack mode |
| `LOCALSTACK_SECRET_ACCESS_KEY` | `test` | Secret key used in LocalStack mode |
| `LOCALSTACK_SESSION_TOKEN` | unset | Optional session token for LocalStack mode |
| `LOCALSTACK_REGION` | `us-east-1` | Region used in LocalStack mode |
| `LOCALSTACK_PREFIX` | unset | Optional key prefix for LocalStack uploads |
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

## Deploying To Fly.io

The current codebase is best deployed as:
- Fly.io for the public HTTP service and browser worker app
- Cloudflare R2 for attachment storage
- local Claude Desktop for the MCP stdio adapter

Files included for this flow:
- `Dockerfile`
- `fly.toml`

The deployed app runs the HTTP service only:

```bash
bun run src/http-server.ts
```

### 1. Create the Fly app and volume

```bash
fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region nrt
```

If you want a different app name, edit `app` in `fly.toml` before deploy.

### 2. Set R2 secrets

```bash
fly secrets set \
  R2_ACCOUNT_ID=... \
  R2_BUCKET=human-calling \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_PUBLIC_BASE_URL=https://assets.example.com
```

### 3. Deploy

```bash
fly deploy
```

The default Fly config:
- serves HTTP on port `8080`
- stores SQLite data under `/data/queries.db`
- stores local uploads under `/data/uploads` if you ever use `ATTACHMENT_STORAGE=local`
- assumes `ATTACHMENT_STORAGE=r2`

## CI/CD

GitHub Actions is set up in [.github/workflows/ci-cd.yml](/Users/moti/dev/src/github.com/motxx/human-calling-mcp/.github/workflows/ci-cd.yml).

What it does:
- on every push and pull request:
  - `bun install --frozen-lockfile`
  - `bun run typecheck`
  - `bun test`
  - `docker build .`
- on pushes to the default branch:
  - deploys to Fly.io with `flyctl deploy --remote-only --config fly.toml`
- on `workflow_dispatch`:
  - lets you trigger the same deploy manually from GitHub Actions

Required GitHub secret:
- `FLY_API_TOKEN`

Create a deploy token with Fly:

```bash
fly tokens create deploy --app human-calling-mcp
```

Then add it in GitHub:
- repository `Settings`
- `Secrets and variables`
- `Actions`
- new repository secret named `FLY_API_TOKEN`

### Why Fly.io instead of Cloudflare Workers

This repository currently depends on:
- `bun:sqlite`
- `Bun.serve()`
- Bun HTML imports for the reference UI

That makes Fly.io a much smaller change than porting the runtime to Workers/D1. Cloudflare still fits very well for storage via R2.

### LocalStack Example

Start LocalStack:

```bash
docker compose -f docker-compose.localstack.yml up -d
```

Use it for attachments:

```bash
ATTACHMENT_STORAGE=localstack
LOCALSTACK_ENDPOINT=http://localhost:4566
LOCALSTACK_BUCKET=human-calling
LOCALSTACK_PUBLIC_BASE_URL=http://localhost:4566/human-calling
```

In this mode, uploaded photo attachments are written to LocalStack S3 and the returned `AttachmentRef.uri` is directly fetchable over HTTP.

## Architecture

```text
src/
  index.ts          SDK entrypoint
  server.ts         reference runtime entrypoint
  runtime.ts        runtime wiring for scheduler + adapters
  reference-app.ts  reference app startup and Bun.serve
  config.ts         environment-backed runtime config
  query-service.ts  query-first SDK surface
  mcp-server.ts     MCP adapter
  worker-api.ts     reference worker HTTP app builder
  verification.ts   lightweight verification rules
  challenge.ts      nonce generation + challenge text
  sqlite-query-store.ts SQLite-backed query store
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
