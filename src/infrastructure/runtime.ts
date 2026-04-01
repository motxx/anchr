import { getRuntimeConfig } from "./config";
import { purgeExpiredQueries } from "../application/data-purge";
import { startMcpServer } from "./mcp-server";
import { expireQueries } from "../application/query-service";
import { startReferenceApp } from "./reference-app";

export interface ReferenceRuntime {
  stopScheduler(): void;
}

export async function startReferenceRuntime(): Promise<ReferenceRuntime> {
  const config = getRuntimeConfig();
  const scheduler = setInterval(async () => {
    const expired = expireQueries();
    if (expired > 0) {
      console.error(`[scheduler] Expired ${expired} query(s)`);
    }
    const purged = await purgeExpiredQueries();
    if (purged > 0) {
      console.error(`[scheduler] Purged ${purged} expired query(s) and their data`);
    }
  }, config.querySweepIntervalMs);

  startReferenceApp().catch((err: unknown) =>
    console.error("[reference-app] Failed to start:", err)
  );

  await startMcpServer();

  return {
    stopScheduler() {
      clearInterval(scheduler);
    },
  };
}
