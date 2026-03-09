import { getRuntimeConfig } from "./config";
import { startMcpServer } from "./mcp-server";
import { expireQueries } from "./query-service";
import { startReferenceApp } from "./reference-app";

export interface ReferenceRuntime {
  stopScheduler(): void;
}

export async function startReferenceRuntime(): Promise<ReferenceRuntime> {
  const config = getRuntimeConfig();
  const scheduler = setInterval(() => {
    const expired = expireQueries();
    if (expired > 0) {
      console.error(`[scheduler] Expired ${expired} query(s)`);
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
