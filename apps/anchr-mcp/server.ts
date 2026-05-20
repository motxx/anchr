import { createQueryService } from "@anchr/bounty/flow";
import { createOracleRegistry } from "@anchr/bounty/oracle-client";
import { normalizeQueryResult } from "@anchr/bounty/attachments";
import { startMcpServer } from "./src/mcp-server.ts";

const queryService = createQueryService({
  oracleRegistry: createOracleRegistry(),
  normalizeResult: normalizeQueryResult,
});
const capabilities = {
  cashu: Boolean(Deno.env.get("CASHU_MINT_URL")?.trim()),
  nostr: Boolean(Deno.env.get("NOSTR_RELAYS")?.trim()),
};

await startMcpServer({ queryService, capabilities });
