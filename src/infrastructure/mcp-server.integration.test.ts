import { join } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect } from "@std/expect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { moduleDir } from "../runtime/mod.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWP8//8/AxJgYGBgAAQYAAHcAQObmQ4AAAAASUVORK5CYII=",
  "base64",
);

function parseTextPayload(result: { content: Array<{ type: string; text?: string }> }) {
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
      args: ["run", "--allow-all", "--unstable-sloppy-imports", "--unstable-detect-cjs", "--no-check", `--config=${join(moduleDir(import.meta), "../../deno.json")}`, this.scriptPath],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
      env: this.env,
    }).spawn();

    this.writer = this.child.stdin.getWriter();

    // Read stdout line by line for JSON-RPC messages
    const reader = this.child.stdout.getReader();
    let buf = "";

    const pump = async () => {
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
    };
    pump();
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
    this.child = null;
    this.writer = null;
  }
}

async function createMcpClient(envOverrides: Record<string, string> = {}, bootstrapPreamble = "") {
  const bootstrap = [
    bootstrapPreamble,
    `const { startMcpServer } = await import(${JSON.stringify(join(moduleDir(import.meta), "mcp-server.ts"))});`,
    "await startMcpServer();",
    "await new Promise(() => {});",
  ].join("\n");

  const tmpDir = mkdtempSync(join(tmpdir(), "anchr-mcp-test-"));
  const scriptPath = join(tmpDir, "bootstrap.ts");
  writeFileSync(scriptPath, bootstrap);

  const transport = new DenoStdioTransport(scriptPath, {
    ...process.env as Record<string, string>,
    REFERENCE_APP_PORT: process.env.REFERENCE_APP_PORT ?? "3000",
    ...envOverrides,
  });

  const client = new Client({ name: "mcp-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

Deno.test({ name: "mcp tools expose query status and attachment metadata", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const attachmentId = `integration_${Date.now()}`;

  // Bootstrap: create query + submit result inside the MCP subprocess so
  // the in-memory store has the data when MCP tools read it.
  const setupPreamble = [
    `const { createQuery, submitQueryResult } = await import(${JSON.stringify(join(moduleDir(import.meta), "../application/query-service.ts"))});`,
    `const { storeIntegrity } = await import(${JSON.stringify(join(moduleDir(import.meta), "verification/integrity-store.ts"))});`,
    `const query = createQuery({ description: "MCP integration test" }, { ttlSeconds: 300 });`,
    `globalThis.__testQueryId = query.id;`,
    `globalThis.__testNonce = query.challenge_nonce;`,
    `const attachment = { id: ${JSON.stringify(attachmentId)}, uri: "https://blossom.example.com/${attachmentId}", mime_type: "image/png", storage_kind: "blossom", filename: "${attachmentId}.png", size_bytes: ${PNG_BYTES.length}, blossom_hash: ${JSON.stringify(attachmentId)}, blossom_servers: ["https://blossom.example.com"] };`,
    `storeIntegrity({ attachmentId: ${JSON.stringify(attachmentId)}, queryId: query.id, capturedAt: Date.now(), exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] }, c2pa: { available: true, hasManifest: true, signatureValid: true, manifest: { title: "${attachmentId}.png" }, checks: ["C2PA manifest found", "C2PA signature valid"], failures: [] } });`,
    `await submitQueryResult(query.id, { attachments: [attachment], notes: "mcp integration" }, { executor_type: "human", channel: "worker_api" });`,
  ].join(" ");

  const client = await createMcpClient({}, setupPreamble);

  try {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_query_attachment")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "get_query_attachment_preview")).toBe(true);

    // Create a query via MCP tool to verify creation works
    const created = await client.callTool({
      name: "create_query",
      arguments: { description: "MCP Test Store の営業状況", ttl_seconds: 120, verification_requirements: [] },
    });
    const createdJson = parseTextPayload(created as { content: Array<{ type: string; text?: string }> });
    expect(createdJson.query_id).toMatch(/^query_/);

    // Submit via MCP to verify + get the query_id from the subprocess
    const submitResult = await client.callTool({
      name: "submit_query_result",
      arguments: {
        query_id: createdJson.query_id,
        result: { attachments: [], notes: "MCP test" },
      },
    });
    const submitJson = parseTextPayload(submitResult as { content: Array<{ type: string; text?: string }> });
    expect(submitJson.ok).toBe(true);

    // Check status of the submitted query
    const status = await client.callTool({
      name: "get_query_status",
      arguments: { query_id: createdJson.query_id },
    });
    const statusJson = parseTextPayload(status as { content: Array<{ type: string; text?: string }> });
    expect(statusJson.status).toBe("approved");

    // Create another query via MCP
    const anotherQuery = await client.callTool({
      name: "create_query",
      arguments: { description: "Attachment test", ttl_seconds: 120 },
    });
    const anotherJson = parseTextPayload(anotherQuery as { content: Array<{ type: string; text?: string }> });
    const anotherQueryId = anotherJson.query_id;

    // Verify we can get attachment tools listed
    const attResult = await client.callTool({
      name: "get_query_attachment",
      arguments: { query_id: anotherQueryId },
    });
    const attJson = parseTextPayload(attResult as { content: Array<{ type: string; text?: string }> });
    // Query is pending, no attachments yet
    expect(attJson.error).toContain("does not have attachments");
  } finally {
    await client.close();
  }
} });

Deno.test({ name: "mcp create_query supports TLSNotary parameters", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const client = await createMcpClient();

  try {
    const created = await client.callTool({
      name: "create_query",
      arguments: {
        description: "BTC price from CoinGecko",
        verification_requirements: ["tlsn"],
        target_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        conditions: [
          { type: "jsonpath", expression: "bitcoin.usd", description: "BTC price exists" },
        ],
        ttl_seconds: 120,
      },
    });
    const json = parseTextPayload(created as { content: Array<{ type: string; text?: string }> });
    expect(json.query_id).toMatch(/^query_/);
    expect(json.verification_requirements).toContain("tlsn");

    // Verify status includes tlsn_requirements
    const status = await client.callTool({
      name: "get_query_status",
      arguments: { query_id: json.query_id },
    });
    const statusJson = parseTextPayload(status as { content: Array<{ type: string; text?: string }> });
    expect(statusJson.status).toBe("pending");
  } finally {
    await client.close();
  }
} });

Deno.test({ name: "mcp can use a remote HTTP query backend", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const baseUrl = "http://remote.test";
  const bootstrapPreamble = [
    `process.env.HTTP_API_KEY = "remote-test-key";`,
    `const { buildWorkerApiApp } = await import(${JSON.stringify(join(moduleDir(import.meta), "worker-api.ts"))});`,
    `const app = buildWorkerApiApp();`,
    `const originalFetch = globalThis.fetch.bind(globalThis);`,
    `globalThis.fetch = async (input, init) => {`,
    `  const url = typeof input === "string" || input instanceof URL ? new URL(input.toString()) : new URL(input.url);`,
    `  if (url.origin === ${JSON.stringify(baseUrl)}) {`,
    `    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");`,
    `    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));`,
    `    const body = init?.body ?? (typeof input === "object" && "body" in input ? input.body : undefined);`,
    `    const request = new Request(url, { method, headers, body, duplex: "half" });`,
    `    return app.fetch(request);`,
    `  }`,
    `  return originalFetch(input, init);`,
    `};`,
  ].join(" ");
  const client = await createMcpClient({
    REMOTE_QUERY_API_BASE_URL: baseUrl,
    REMOTE_QUERY_API_KEY: "remote-test-key",
    REFERENCE_APP_PORT: "3000",
  }, bootstrapPreamble);

  try {
    const created = await client.callTool({
      name: "create_query",
      arguments: {
        description: "Remote MCP Smoke Store の営業状況",
        location_hint: "Tokyo",
        ttl_seconds: 180,
        verification_requirements: [],
      },
    });
    const createdJson = parseTextPayload(created as { content: Array<{ type: string; text?: string }> });
    expect(createdJson.query_id).toMatch(/^query_/);
    expect(createdJson.reference_app_url).toContain(baseUrl);
    expect(createdJson.requester_meta?.client_name).toBe("mcp-remote");

    const listed = await client.callTool({
      name: "list_available_queries",
      arguments: {},
    });
    const listedJson = parseTextPayload(listed as { content: Array<{ type: string; text?: string }> }) as Array<{ query_id: string }>;
    expect(listedJson.some((query) => query.query_id === createdJson.query_id)).toBe(true);

    const submit = await client.callTool({
      name: "submit_query_result",
      arguments: {
        query_id: createdJson.query_id,
        result: {
          attachments: [],
          notes: "Observed storefront, looked open",
        },
      },
    });
    const submitJson = parseTextPayload(submit as { content: Array<{ type: string; text?: string }> });
    expect(submitJson.ok).toBe(true);
    expect(submitJson.payment_status).toBe("released");

    const status = await client.callTool({
      name: "get_query_status",
      arguments: { query_id: createdJson.query_id },
    });
    const statusJson = parseTextPayload(status as { content: Array<{ type: string; text?: string }> });
    expect(statusJson.status).toBe("approved");
    expect(statusJson.requester_meta?.client_name).toBe("mcp-remote");
  } finally {
    await client.close();
  }
} });
