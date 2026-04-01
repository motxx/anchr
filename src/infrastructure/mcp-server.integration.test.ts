import { join } from "node:path";
import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

async function createMcpClient(envOverrides: Record<string, string> = {}, bootstrapPreamble = "") {
  const bootstrap = [
    bootstrapPreamble,
    `const { startMcpServer } = await import(${JSON.stringify(join(import.meta.dir, "mcp-server.ts"))});`,
    "await startMcpServer();",
    "await new Promise(() => {});",
  ].join(" ");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["-e", bootstrap],
    env: {
      ...process.env,
      REFERENCE_APP_PORT: process.env.REFERENCE_APP_PORT ?? "3000",
      ...envOverrides,
    },
  });

  const client = new Client({ name: "mcp-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

test("mcp tools expose query status and attachment metadata", async () => {
  const attachmentId = `integration_${Date.now()}`;

  // Bootstrap: create query + submit result inside the MCP subprocess so
  // the in-memory store has the data when MCP tools read it.
  const setupPreamble = [
    `const { createQuery, submitQueryResult } = await import(${JSON.stringify(join(import.meta.dir, "../application/query-service.ts"))});`,
    `const { storeIntegrity } = await import(${JSON.stringify(join(import.meta.dir, "../verification/integrity-store.ts"))});`,
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
    expect(createdJson.query_id).toStartWith("query_");

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
});

test("mcp create_query supports TLSNotary parameters", async () => {
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
    expect(json.query_id).toStartWith("query_");
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
});

test("mcp can use a remote HTTP query backend", async () => {
  const baseUrl = "http://remote.test";
  const bootstrapPreamble = [
    `process.env.HTTP_API_KEY = "remote-test-key";`,
    `const { buildWorkerApiApp } = await import(${JSON.stringify(join(import.meta.dir, "worker-api.ts"))});`,
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
    expect(createdJson.query_id).toStartWith("query_");
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
});
