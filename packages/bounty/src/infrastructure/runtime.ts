import {
  createPersistentPreimageStore,
  type PreimageStore,
} from "@anchr/core-cashu/preimage-store";
import { isCashuEnabled } from "@anchr/core-cashu/wallet";
import type { Hono } from "hono";
import { dirname } from "node:path";
import { getRuntimeConfig } from "./config.ts";
import { purgeExpiredQueries } from "../application/data-purge.ts";
import {
  createQueryService,
  type QueryService,
} from "../application/query-service.ts";
import { buildWorkerApiApp, type WorkerApiDeps } from "./worker-api.ts";
import { setupServerLogCapture } from "./log-stream.ts";
import { createOracleRegistry } from "./oracle-client/registry.ts";
import type { OracleRegistry } from "./oracle-client/registry.ts";
import { normalizeQueryResult } from "./attachments.ts";
import { isNostrEnabled } from "./nostr/transport/client.ts";
import { publishQueryToRelay } from "./nostr/transport/relay-publish.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "scheduler"]);
const apiLog = getLogger(["anchr", "http-api"]);

export interface RuntimeCapabilities {
  cashu: boolean;
  nostr: boolean;
}

export interface HostComposition {
  queryService: QueryService;
  preimageStore: PreimageStore;
  oracleRegistry: OracleRegistry;
  app: Hono;
  capabilities: RuntimeCapabilities;
}

export interface ComposeHostOptions {
  /** Hook to register example-specific HTTP routes on the worker-api app. */
  extraRoutes?: WorkerApiDeps["extraRoutes"];
}

/**
 * Sanctioned extension point for example apps that need to embed the
 * Anchr host (data-marketplace, future variants). Builds the standard
 * QueryService + worker-api app without side effects, leaving
 * `Deno.serve` and the scheduler to the caller.
 *
 * `startReferenceRuntime` below is the side-effecting wrapper that
 * `bin/anchr` and `src/infrastructure/server.ts` call.
 */
export function composeHost(opts?: ComposeHostOptions): HostComposition {
  const config = getRuntimeConfig();
  Deno.mkdirSync(dirname(config.preimageStorePath), { recursive: true });
  const preimageStore = createPersistentPreimageStore(config.preimageStorePath);
  const oracleRegistry = createOracleRegistry();
  const queryService = createQueryService({
    preimageStore,
    oracleRegistry,
    normalizeResult: normalizeQueryResult,
    hooks: { onCreated: publishQueryToRelay },
  });
  const app = buildWorkerApiApp({
    queryService,
    preimageStore,
    oracleRegistry,
    extraRoutes: opts?.extraRoutes,
  });
  return {
    queryService,
    preimageStore,
    oracleRegistry,
    app,
    capabilities: { cashu: isCashuEnabled(), nostr: isNostrEnabled() },
  };
}

export interface ReferenceRuntime {
  stopScheduler(): void;
}

export async function startReferenceRuntime(): Promise<ReferenceRuntime> {
  const config = getRuntimeConfig();
  const { queryService, app } = composeHost();

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

  setupServerLogCapture();
  Deno.serve({ port: config.httpApiPort }, app.fetch);
  apiLog.error(`HTTP API → http://localhost:${config.httpApiPort}`);

  return {
    stopScheduler() {
      clearInterval(scheduler);
    },
  };
}
