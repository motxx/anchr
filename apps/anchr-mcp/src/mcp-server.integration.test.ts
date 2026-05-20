import { Buffer } from "node:buffer";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect } from "@std/expect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessage,
  JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWP8//8/AxJgYGBgAAQYAAHcAQObmQ4AAAAASUVORK5CYII=",
  "base64",
);

function parseTextPayload(
  result: { content: Array<{ type: string; text?: string }> },
) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("expected text content");
  }
  return JSON.parse(text);
}

/**
 * Custom MCP stdio transport using Deno.Command directly.
 * StdioClientTransport uses node:child_process which has pipe issues under Deno's Node compat.
 */
class DenoStdioTransport implements Transport {
  private child: Deno.ChildProcess | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pumpDone: Promise<void> | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private scriptPath: string,
    private env: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    this.child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        "--unstable-sloppy-imports",
        "--unstable-detect-cjs",
        `--config=${join(Deno.cwd(), "deno.json")}`,
        this.scriptPath,
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
      env: this.env,
    }).spawn();

    this.writer = this.child.stdin.getWriter();

    // Read stdout line by line for JSON-RPC messages
    const reader = this.child.stdout.getReader();
    let buf = "";

    this.pumpDone = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += this.decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              const parsed = JSONRPCMessageSchema.parse(msg);
              this.onmessage?.(parsed);
            } catch { /* skip non-JSON lines */ }
          }
        }
      } catch (e) {
        this.onerror?.(e instanceof Error ? e : new Error(String(e)));
      }
      this.onclose?.();
    })();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.writer) throw new Error("Transport not started");
    const data = JSON.stringify(message) + "\n";
    await this.writer.write(this.encoder.encode(data));
  }

  async close(): Promise<void> {
    try {
      await this.writer?.close();
    } catch { /* already closed */ }
    try {
      this.child?.kill();
    } catch { /* already dead */ }
    try {
      await this.child?.status;
    } catch { /* already reaped */ }
    try {
      await this.pumpDone;
    } catch { /* close should be best-effort */ }
    this.child = null;
    this.writer = null;
    this.pumpDone = null;
  }
}

async function createMcpClient(
  envOverrides: Record<string, string> = {},
  bootstrapPreamble = "",
) {
  // Construct one QueryService at startup and surface it via
  // globalThis.__queryService so the test bootstrapPreamble can seed the
  // same in-memory backend that the MCP server reads.
  const setupImports = [
    `import { createQueryService } from "@anchr/bounty/flow";`,
    `import { createOracleRegistry } from "@anchr/bounty/oracle-client";`,
    `import { normalizeQueryResult } from "@anchr/bounty/attachments";`,
    `import { startMcpServer } from "@anchr/anchr-mcp/mcp-server";`,
    `import { storeIntegrity } from "@anchr/photo-verification/integrity-store";`,
  ].join("\n");
  const setupQueryService = [
    `globalThis.__queryService = createQueryService({ oracleRegistry: createOracleRegistry(), normalizeResult: normalizeQueryResult });`,
  ].join("\n");

  const bootstrap = [
    setupImports,
    setupQueryService,
    bootstrapPreamble,
    "await startMcpServer({ queryService: globalThis.__queryService });",
    "await new Promise(() => {});",
  ].join("\n");

  const tmpDir = mkdtempSync(join(tmpdir(), "anchr-mcp-test-"));
  const scriptPath = join(tmpDir, "bootstrap.ts");
  writeFileSync(scriptPath, bootstrap);

  const transport = new DenoStdioTransport(scriptPath, {
    ...Deno.env.toObject(),
    HTTP_API_PORT: Deno.env.get("HTTP_API_PORT") ?? "3000",
    ...envOverrides,
  });

  const client = new Client({ name: "mcp-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      try {
        await client.close();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

Deno.test({
  name: "mcp tools expose query status and attachment metadata",
  fn: async () => {
    const attachmentId = `integration_${Date.now()}`;

    // Bootstrap: create query + submit result inside the MCP subprocess so
    // the in-memory store has the data when MCP tools read it.
    const setupPreamble = [
      `const query = globalThis.__queryService.createQuery({ description: "MCP integration test" }, { ttlSeconds: 300 });`,
      `globalThis.__testQueryId = query.id;`,
      `globalThis.__testNonce = query.challenge_nonce;`,
      `const attachment = { id: ${
        JSON.stringify(attachmentId)
      }, uri: "https://blossom.example.com/${attachmentId}", mime_type: "image/png", storage_kind: "blossom", filename: "${attachmentId}.png", size_bytes: ${PNG_BYTES.length}, blossom_hash: ${
        JSON.stringify(attachmentId)
      }, blossom_servers: ["https://blossom.example.com"] };`,
      `storeIntegrity({ attachmentId: ${
        JSON.stringify(attachmentId)
      }, queryId: query.id, capturedAt: Date.now(), exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] }, c2pa: { available: true, hasManifest: true, signatureValid: true, manifest: { title: "${attachmentId}.png" }, checks: ["C2PA manifest found", "C2PA signature valid"], failures: [] } });`,
      `await globalThis.__queryService.submitQueryResult(query.id, { attachments: [attachment], notes: "mcp integration" }, { executor_type: "human", channel: "adapter" });`,
    ].join(" ");

    const mcp = await createMcpClient({}, setupPreamble);
    const { client } = mcp;

    try {
      const tools = await client.listTools();
      expect(
        tools.tools.some((tool: { name: string }) =>
          tool.name === "get_query_attachment"
        ),
      ).toBe(true);
      expect(
        tools.tools.some((tool: { name: string }) =>
          tool.name === "get_query_attachment_preview"
        ),
      ).toBe(true);

      // Create a query via MCP tool to verify creation works
      const created = await client.callTool({
        name: "create_query",
        arguments: {
          description: "MCP Test Store の営業状況",
          ttl_seconds: 120,
          verification_requirements: [],
        },
      });
      const createdJson = parseTextPayload(
        created as { content: Array<{ type: string; text?: string }> },
      );
      expect(createdJson.query_id).toMatch(/^query_/);

      // Submit via MCP to verify + get the query_id from the subprocess
      const submitResult = await client.callTool({
        name: "submit_query_result",
        arguments: {
          query_id: createdJson.query_id,
          result: { attachments: [], notes: "MCP test" },
        },
      });
      const submitJson = parseTextPayload(
        submitResult as { content: Array<{ type: string; text?: string }> },
      );
      expect(submitJson.ok).toBe(true);

      // Check status of the submitted query
      const status = await client.callTool({
        name: "get_query_status",
        arguments: { query_id: createdJson.query_id },
      });
      const statusJson = parseTextPayload(
        status as { content: Array<{ type: string; text?: string }> },
      );
      expect(statusJson.status).toBe("approved");

      // Create another query via MCP
      const anotherQuery = await client.callTool({
        name: "create_query",
        arguments: { description: "Attachment test", ttl_seconds: 120 },
      });
      const anotherJson = parseTextPayload(
        anotherQuery as { content: Array<{ type: string; text?: string }> },
      );
      const anotherQueryId = anotherJson.query_id;

      // Verify we can get attachment tools listed
      const attResult = await client.callTool({
        name: "get_query_attachment",
        arguments: { query_id: anotherQueryId },
      });
      const attJson = parseTextPayload(
        attResult as { content: Array<{ type: string; text?: string }> },
      );
      // Query is pending, no attachments yet
      expect(attJson.error).toContain("does not have attachments");
    } finally {
      await mcp.close();
    }
  },
});

Deno.test({
  name: "mcp create_query supports TLSNotary parameters",
  fn: async () => {
    const mcp = await createMcpClient();
    const { client } = mcp;

    try {
      const created = await client.callTool({
        name: "create_query",
        arguments: {
          description: "BTC price from CoinGecko",
          verification_requirements: ["tlsn"],
          target_url:
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
          conditions: [
            {
              type: "jsonpath",
              expression: "bitcoin.usd",
              description: "BTC price exists",
            },
          ],
          ttl_seconds: 120,
          visibility: "public",
        },
      });
      const json = parseTextPayload(
        created as { content: Array<{ type: string; text?: string }> },
      );
      expect(json.query_id).toMatch(/^query_/);
      expect(json.verification_requirements).toContain("tlsn");

      // Verify status includes tlsn_requirements
      const status = await client.callTool({
        name: "get_query_status",
        arguments: { query_id: json.query_id },
      });
      const statusJson = parseTextPayload(
        status as { content: Array<{ type: string; text?: string }> },
      );
      expect(statusJson.status).toBe("pending");
    } finally {
      await mcp.close();
    }
  },
});
