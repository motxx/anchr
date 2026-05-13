import { composeHost } from "@anchr/bounty";
import { startMcpServer } from "./src/mcp-server.ts";

const { queryService, capabilities } = composeHost();

await startMcpServer({ queryService, capabilities });
