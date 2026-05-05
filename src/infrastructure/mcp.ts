import { startMcpServer } from "./mcp-server.ts";
import { createQueryService } from "../application/query-service.ts";
import { createOracleRegistry } from "./oracle/discovery/registry.ts";
import { normalizeQueryResult } from "./attachments.ts";
import { createPreimageStore } from "@anchr/core-cashu/preimage-store";

// Standalone MCP entry point (used by `deno run mcp.ts`). Constructs its
// own QueryService — no shared state with a separately-running HTTP host.
const queryService = createQueryService({
  preimageStore: createPreimageStore(),
  oracleRegistry: createOracleRegistry(),
  normalizeResult: normalizeQueryResult,
});

await startMcpServer({ queryService });
