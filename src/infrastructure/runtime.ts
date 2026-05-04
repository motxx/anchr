import { createPreimageStore } from "@anchr/core-cashu/preimage-store";
import { getRuntimeConfig } from "./config.ts";
import { purgeExpiredQueries } from "../application/data-purge.ts";
import { startMcpServer } from "./mcp-server.ts";
import { createQueryService } from "../application/query-service.ts";
import { startReferenceApp } from "./reference-app.ts";
import { createOracleRegistry } from "./oracle/registry.ts";
import { normalizeQueryResult } from "./attachments.ts";
import { publishQueryToRelay } from "./nostr/relay-publish.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "scheduler"]);

export interface ReferenceRuntime {
  stopScheduler(): void;
}

export async function startReferenceRuntime(): Promise<ReferenceRuntime> {
  const config = getRuntimeConfig();

  // Single composition root — one QueryService shared across the HTTP
  // server, the MCP server, and the scheduler so they all see the same
  // store / oracle registry / preimage store.
  const preimageStore = createPreimageStore();
  const oracleRegistry = createOracleRegistry();
  const queryService = createQueryService({
    preimageStore,
    oracleRegistry,
    normalizeResult: normalizeQueryResult,
    hooks: { onCreated: publishQueryToRelay },
  });

  const scheduler = setInterval(async () => {
    const expired = queryService.expireQueries();
    if (expired > 0) {
      log.error(`Expired ${expired} query(s)`);
    }
    const purged = await purgeExpiredQueries(queryService);
    if (purged > 0) {
      log.error(`Purged ${purged} expired query(s) and their data`);
    }
  }, config.querySweepIntervalMs);

  startReferenceApp({ queryService, preimageStore, oracleRegistry }).catch((err: unknown) =>
    log.error("Failed to start:", err)
  );

  await startMcpServer({ queryService });

  return {
    stopScheduler() {
      clearInterval(scheduler);
    },
  };
}
