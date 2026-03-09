import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { UPLOADS_DIR } from "./attachments";
import { createQuery, queryTemplates, submitQueryResult } from "./query-service";
import type { AttachmentRef } from "./types";

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

function getContentTypes(result: unknown) {
  return (result as { content: Array<{ type: string }> }).content.map((item) => item.type);
}

function previewSupported() {
  return process.platform === "darwin" || Boolean(Bun.which("magick") || Bun.which("convert"));
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
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const filename = `integration_${Date.now()}.png`;
  const localPath = join(UPLOADS_DIR, filename);
  await Bun.write(localPath, PNG_BYTES);

  const query = createQuery(queryTemplates.photoProof("MCP integration test"), { ttlSeconds: 300 });
  const attachment: AttachmentRef = {
    id: filename,
    uri: `/uploads/${filename}`,
    mime_type: "image/png",
    storage_kind: "local",
    filename,
    size_bytes: PNG_BYTES.length,
    local_file_path: localPath,
    route_path: `/uploads/${filename}`,
  };
  const outcome = await submitQueryResult(query.id, {
    type: "photo_proof",
    text_answer: `Observed storefront ${query.challenge_nonce}`,
    attachments: [attachment],
    notes: "mcp integration",
  }, {
    executor_type: "human",
    channel: "worker_api",
  });

  expect(outcome.ok).toBe(true);

  const client = await createMcpClient();

  try {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_query_attachment")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "get_query_attachment_preview")).toBe(true);

    const status = await client.callTool({
      name: "get_query_status",
      arguments: { query_id: query.id },
    });
    const statusJson = parseTextPayload(status as { content: Array<{ type: string; text?: string }> });
    expect(statusJson.status).toBe("approved");
    expect(statusJson.attachment_count).toBe(1);
    expect(statusJson.attachments[0]?.access?.view_url).toContain(`/queries/${query.id}/attachments/0`);

    const attachment = await client.callTool({
      name: "get_query_attachment",
      arguments: { query_id: query.id },
    });
    expect(getContentTypes(attachment)).toEqual(["text"]);
    const attachmentJson = parseTextPayload(attachment as { content: Array<{ type: string; text?: string }> });
    expect(attachmentJson.attachment.id).toBe(filename);
    expect(attachmentJson.attachment.storage_kind).toBe("local");
    expect(attachmentJson.access.original_url).toContain("/uploads/");
    expect(attachmentJson.access.preview_url).toContain(`/queries/${query.id}/attachments/0/preview`);
    expect(attachmentJson.preview_hint).toContain("get_query_attachment_preview");

    if (previewSupported()) {
      const preview = await client.callTool({
        name: "get_query_attachment_preview",
        arguments: { query_id: query.id, max_dimension: 256 },
      });
      expect(getContentTypes(preview)).toContain("image");
      const previewJson = parseTextPayload(preview as { content: Array<{ type: string; text?: string }> });
      expect(previewJson.preview_mime_type).toBe("image/jpeg");
      expect(previewJson.max_dimension).toBe(256);
    }
  } finally {
    await client.close();
    rmSync(localPath, { force: true });
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
      name: "request_store_status",
      arguments: {
        store_name: "Remote MCP Smoke Store",
        location_hint: "Tokyo",
        ttl_seconds: 180,
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
          type: "store_status",
          status: "open",
          notes: `Observed storefront ${createdJson.challenge_nonce}`,
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
