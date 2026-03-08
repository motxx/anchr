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

async function createMcpClient() {
  const bootstrap = [
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
  const outcome = submitQueryResult(query.id, {
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
