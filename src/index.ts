import { expireJobs } from "./db";
import { startMcpServer } from "./mcp-server";
import { startWorkerApi } from "./worker-api";

// Periodically expire stale jobs
setInterval(() => {
  const n = expireJobs();
  if (n > 0) console.error(`[scheduler] Expired ${n} job(s)`);
}, 30_000);

// Start worker-facing HTTP API in background — must not block MCP startup
startWorkerApi().catch((err: unknown) =>
  console.error("[worker-api] Failed to start:", err)
);

// Start MCP server (stdio) — this blocks until Claude Desktop closes the connection
await startMcpServer();
