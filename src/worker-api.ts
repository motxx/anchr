import { join } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { getAttachmentStore } from "./attachment-store";
import {
  buildAttachmentAbsoluteUrl,
  buildQueryAttachmentUrls,
  materializeAttachmentRef,
  materializeQueryResult,
  statStoredAttachment,
  UPLOADS_DIR,
} from "./attachments";
import {
  cancelQuery,
  getQuery as getQueryById,
  listOpenQueries,
  submitQueryResult,
  type Query,
  type QueryResult,
} from "./query-service";
import type { AttachmentRef } from "./types";

export async function prepareWorkerApiAssets() {
  const cssIn = join(import.meta.dir, "ui/globals.css");
  const cssOut = join(import.meta.dir, "ui/generated.css");
  // stdout/stderr must be "pipe" — never "inherit", which would corrupt MCP stdio
  // Use process.execPath (absolute path to bun binary) instead of "bunx"
  // so this works even when the nix store is not in Claude Desktop's PATH
  const proc = Bun.spawn([process.execPath, "x", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error("[css-build] Failed:", await new Response(proc.stderr).text());
  }
}

function querySummary(query: Query) {
  return {
    id: query.id,
    type: query.type,
    status: query.status,
    params: query.params,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: query.expires_at,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
  };
}

function materializeResult(result: QueryResult | undefined, requestUrl: string): QueryResult | undefined {
  if (!result) return undefined;
  return materializeQueryResult(result, requestUrl);
}

function queryDetail(query: Query, requestUrl: string) {
  return {
    ...querySummary(query),
    created_at: query.created_at,
    submitted_at: query.submitted_at,
    result: materializeResult(query.result, requestUrl),
    verification: query.verification,
    submission_meta: query.submission_meta,
    payment_status: query.payment_status,
  };
}

function getPhotoProofAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (query.type !== "photo_proof" || query.result?.type !== "photo_proof") {
    return null;
  }

  return query.result.attachments;
}

async function buildAttachmentPayload(query: Query, attachment: AttachmentRef, index: number, requestUrl: string) {
  const stat = await statStoredAttachment(attachment, requestUrl);
  const materialized = materializeAttachmentRef(attachment, requestUrl);
  const urls = buildQueryAttachmentUrls(query.id, index, requestUrl);

  return {
    query_id: query.id,
    attachment_index: index,
    attachment: materialized,
    attachment_view_url: urls.viewUrl,
    attachment_meta_url: urls.metaUrl,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachment, requestUrl),
    local_file_path: stat?.path ?? null,
    storage_kind: stat?.storageKind ?? materialized.storage_kind,
    mime_type: stat?.mimeType ?? materialized.mime_type,
    size_bytes: stat?.size ?? materialized.size_bytes ?? null,
  };
}

export function buildWorkerApiApp() {
  const app = new Hono();
  const listQueries = (c: Context) =>
    c.json(listOpenQueries().map(querySummary));
  const getQuery = (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = getQueryById(id);
    return query ? c.json(queryDetail(query, c.req.url)) : c.json({ error: "Query not found" }, 404);
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/queries", listQueries);

  app.get("/queries/:id", getQuery);

  app.get("/queries/:id/attachments", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);

    const query = getQueryById(id);
    if (!query) return c.json({ error: "Query not found" }, 404);

    const attachments = getPhotoProofAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have photo proof attachments" }, 404);

    const payloads = await Promise.all(
      attachments.map((attachment, index) => buildAttachmentPayload(query, attachment, index, c.req.url)),
    );

    return c.json(payloads);
  });

  app.get("/queries/:id/attachments/:index/meta", async (c) => {
    const id = c.req.param("id");
    const index = Number(c.req.param("index"));
    if (!id) return c.json({ error: "Query id is required" }, 400);
    if (!Number.isInteger(index) || index < 0) {
      return c.json({ error: "Attachment index must be a non-negative integer" }, 400);
    }

    const query = getQueryById(id);
    if (!query) return c.json({ error: "Query not found" }, 404);

    const attachments = getPhotoProofAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have photo proof attachments" }, 404);

    const attachment = attachments[index];
    if (!attachment) return c.json({ error: "Attachment not found" }, 404);

    return c.json(await buildAttachmentPayload(query, attachment, index, c.req.url));
  });

  app.get("/queries/:id/attachments/:index", async (c) => {
    const id = c.req.param("id");
    const index = Number(c.req.param("index"));
    if (!id) return c.json({ error: "Query id is required" }, 400);
    if (!Number.isInteger(index) || index < 0) {
      return c.json({ error: "Attachment index must be a non-negative integer" }, 400);
    }

    const query = getQueryById(id);
    if (!query) return c.json({ error: "Query not found" }, 404);

    const attachments = getPhotoProofAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have photo proof attachments" }, 404);

    const attachment = attachments[index];
    if (!attachment) return c.json({ error: "Attachment not found" }, 404);

    const stat = await statStoredAttachment(attachment, c.req.url);
    if (!stat) return c.json({ error: "Attachment file not found" }, 404);

    if (stat.storageKind === "local") {
      const file = Bun.file(stat.path!);
      if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
      return new Response(file, {
        headers: {
          "content-type": stat.mimeType,
          "content-length": String(stat.size),
          "cache-control": "public, max-age=3600",
        },
      });
    }

    return c.redirect(stat.absoluteUrl, 302);
  });

  const uploadHandler = async (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = getQueryById(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    if (query.status !== "pending") return c.json({ error: "Query not pending" }, 409);

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400);
    }

    const file = formData.get("photo");
    if (!file || typeof file === "string") {
      return c.json({ error: "Missing photo field" }, 400);
    }

    const ext = (file as File).name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".jpg";
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];
    if (!allowed.includes(ext)) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    }

    const stored = await getAttachmentStore().put(id, file as File, c.req.url);
    return c.json({
      ok: true,
      attachment: materializeAttachmentRef(stored.attachment, c.req.url),
    });
  };

  app.post("/queries/:id/upload", uploadHandler);

  app.get("/uploads/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("..") || filename.includes("/")) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const file = Bun.file(join(UPLOADS_DIR, filename));
    if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
    return new Response(file);
  });

  const submitHandler = async (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const outcome = submitQueryResult(id, body as QueryResult, {
      executor_type: "human",
      channel: "worker_api",
    });
    const status = !outcome.query
      ? 404
      : !outcome.ok &&
        outcome.query.status !== "pending" &&
        outcome.query.status !== "rejected"
      ? 409
      : outcome.ok
      ? 200
      : 422;
    return c.json(
      {
        ok: outcome.ok,
        message: outcome.message,
        verification: outcome.query?.verification,
        payment_status: outcome.query?.payment_status,
      },
      status
    );
  };

  app.post("/queries/:id/submit", submitHandler);

  const cancelHandler = (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const outcome = cancelQuery(id);
    return c.json(outcome, outcome.ok ? 200 : 400);
  };

  app.post("/queries/:id/cancel", cancelHandler);

  return app;
}
