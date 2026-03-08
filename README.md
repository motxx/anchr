# 🤖→👤 human-calling-mcp

> Give your AI agent the ability to ask real humans for help — and only pay when the answer passes verification.

An **MCP server** that lets AI agents post short, verifiable tasks to humans. Workers submit structured results; automated verification runs before payment releases. No gig platform. No open-ended prompts. Just typed tool calls.

```
Agent: "Is this store open right now?"
  → creates job with nonce challenge
  → human visits store, submits answer + nonce
  → verification passes → payment released
  → agent gets structured result
```

---

## Why

AI agents are bad at:
- knowing if a store is open right now
- reading a sign that isn't indexed anywhere
- verifying a price on a page that blocks scrapers
- confirming something actually exists in the physical world

This server gives agents a **human observation tool** — the same way they have web search or code execution.

---

## Quick Start

**1. Clone and install**
```bash
git clone https://github.com/motxx/human-calling-mcp
cd human-calling-mcp
bun install
```

**2. Add to Claude Desktop**

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "human-calling": {
      "command": "bun",
      "args": ["run", "/path/to/human-calling-mcp/src/index.ts"],
      "env": {
        "WORKER_PORT": "3000"
      }
    }
  }
}
```

**3. Open the worker dashboard**

```
http://localhost:3000
```

That's it. Ask Claude something like:
> *"I need to know if the Starbucks near Shibuya station is currently open. Can you check using the human verification tool?"*

Claude will create a job. The dashboard shows it. You submit the answer. Claude gets the result.

---

## How It Works

```
┌─────────────┐   MCP tools    ┌──────────────────┐
│  AI Agent   │ ─────────────► │  MCP Server      │
│  (Claude)   │ ◄───────────── │  (this repo)     │
└─────────────┘   job result   └────────┬─────────┘
                                        │ HTTP
                                        ▼
                               ┌──────────────────┐
                               │  Worker Dashboard │  ← localhost:3000
                               │  (browser UI)     │
                               └────────┬─────────┘
                                        │ submits answer
                                        ▼
                               ┌──────────────────┐
                               │  Verification    │
                               │  Engine          │
                               └────────┬─────────┘
                                        │ pass → payment released
                                        │ fail → payment cancelled
                                        ▼
                               ┌──────────────────┐
                               │  SQLite DB       │
                               └──────────────────┘
```

### Anti-gaming: the nonce challenge

Every job includes a randomly generated 4-character nonce (e.g. `K7P4`).

Workers must include the nonce in their answer. This:
- Prevents reusing old submissions
- Prevents trivially farming jobs with pre-generated answers
- Ties the answer to this specific job

The system verifies the nonce is present before releasing payment.

---

## MCP Tools

| Tool | What it does |
|------|-------------|
| `request_photo_proof` | Ask a human to photograph something and include a nonce |
| `request_store_status` | Ask if a store/place is currently open or closed |
| `request_webpage_field` | Ask a human to extract a specific field from a URL |
| `get_job_status` | Poll a job for its current status and result |
| `cancel_job` | Cancel a pending job |
| `list_available_jobs` | Debug tool: list all pending jobs |
| `submit_job_result` | Debug tool: submit a result without the web UI |

---

## Job Types

### `store_status`
```
Agent asks: "Is ○○ store open right now?"
Worker returns:
  - status: "open" | "closed"
  - notes: must include nonce
Verification: status is valid enum, nonce present in notes
```

### `photo_proof`
```
Agent asks: "Take a photo of X"
Worker returns:
  - text_answer: description, must include nonce
  - notes: optional
Verification: text not empty, nonce present
```

### `webpage_field`
```
Agent asks: "What's the price on this URL?"
Worker returns:
  - answer: the extracted value
  - proof_text: text near anchor_word on the page
  - notes: optional
Verification: answer not empty, anchor word present in proof_text
```

---

## Worker Dashboard

Open `http://localhost:3000` to see and claim jobs.

- Jobs auto-refresh every 3 seconds
- The nonce is displayed prominently
- Form adapts to job type
- Shows pass/fail result inline after submit

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_PORT` | `3000` | Port for the worker dashboard and API |
| `DB_PATH` | `jobs.db` | Path to the SQLite database |

---

## Payment (stub)

Payment is tracked as `locked → released | cancelled` in the DB.

Lightning Network integration (hold invoices) is the intended next step — the data model is designed for it, but the actual payment is a stub for now. The verification logic and lifecycle are real.

If you want to add Lightning:
- Reserve a hold invoice when job is created
- Settle on verification pass
- Cancel on verification fail or timeout

---

## Architecture

```
src/
  index.ts          entry point — starts both servers
  mcp-server.ts     MCP stdio server — agent-facing tools
  worker-api.ts     HTTP server — worker dashboard + API
  worker-ui.ts      embedded HTML for the worker dashboard
  jobs.ts           job creation, submission, cancellation
  verification.ts   automated verification per job type
  challenge.ts      nonce generation + challenge rules
  db.ts             SQLite via bun:sqlite
  types.ts          shared types
```

---

## Extending

**Add a new job type:**

1. Add type to `JobParams` / `JobResult` in `types.ts`
2. Add challenge rule in `challenge.ts`
3. Add verification logic in `verification.ts`
4. Add MCP tool in `mcp-server.ts`
5. Add form fields in `worker-ui.ts`

---

## Roadmap

- [ ] Lightning hold invoice payment
- [ ] Webhook support (instead of polling)
- [ ] Multi-shot photo capture
- [ ] Worker reputation / history
- [ ] Remote MCP (HTTP transport)
- [ ] `npx` / `bunx` one-liner

---

## License

MIT
