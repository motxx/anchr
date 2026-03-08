import { expireQueries } from "./query-service";
import { startMcpServer } from "./mcp-server";
import { startWorkerApi } from "./worker-api";

setInterval(() => {
  const n = expireQueries();
  if (n > 0) console.error(`[scheduler] Expired ${n} query(s)`);
}, 30_000);

startWorkerApi().catch((err: unknown) =>
  console.error("[reference-app] Failed to start:", err)
);

await startMcpServer();
