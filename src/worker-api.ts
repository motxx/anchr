import { join } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { getAttachmentStore } from "./attachment-store";
import {
  materializeAttachmentRef,
  renderStoredAttachmentPreview,
  statStoredAttachment,
  UPLOADS_DIR,
} from "./attachments";
import { getRuntimeConfig } from "./config";
import { isNostrEnabled } from "./nostr/client";
import { publishQueryToNostr } from "./nostr/query-bridge";
import {
  cancelQuery,
  createQuery,
  getQuery as getQueryById,
  listOpenQueries,
  submitQueryResult,
  type QueryInput,
  type QueryResult,
} from "./query-service";

import { createQuerySchema } from "./api/schemas";
import { requireWriteApiKey } from "./api/auth";
import {
  buildAttachmentPayload,
  buildCreatedQueryPayload,
  getPhotoProofAttachmentRefs,
  getPublicRequestUrl,
  queryDetail,
  querySummary,
} from "./api/presenters";

export async function prepareWorkerApiAssets() {
  const cssIn = join(import.meta.dir, "ui/globals.css");
  const cssOut = join(import.meta.dir, "ui/generated.css");
  const proc = Bun.spawn([process.execPath, "x", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error("[css-build] Failed:", await new Response(proc.stderr).text());
  }
}

export function buildWorkerApiApp() {
  const app = new Hono();
  const listQueries = (c: Context) =>
    c.json(listOpenQueries().map(querySummary));
  const getQuery = (c: Context) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = getQueryById(id);
    const requestUrl = getPublicRequestUrl(c);
    return query ? c.json(queryDetail(query, requestUrl)) : c.json({ error: "Query not found" }, 404);
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/queries", listQueries);

  app.get("/queries/:id", getQuery);

  app.post("/queries", async (c) => {
    const unauthorized = requireWriteApiKey(c);
    if (unauthorized) return unauthorized;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = createQuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid query payload",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const payload = parsed.data;
    let input: QueryInput;

    switch (payload.type) {
      case "photo_proof":
        input = {
          type: "photo_proof",
          target: payload.target,
          location_hint: payload.location_hint,
        };
        break;
      case "store_status":
        input = {
          type: "store_status",
          store_name: payload.store_name,
          location_hint: payload.location_hint,
        };
        break;
      case "webpage_field":
        input = {
          type: "webpage_field",
          url: payload.url,
          field: payload.field,
          anchor_word: payload.anchor_word,
        };
        break;
    }

    const query = createQuery(input, {
      ttlSeconds: payload.ttl_seconds,
      requesterMeta: payload.requester,
      bounty: payload.bounty,
    });

    if (isNostrEnabled()) {
      const regionHint = (input as unknown as Record<string, unknown>).location_hint as string | undefined;
      publishQueryToNostr(input, {
        ttlMs: (payload.ttl_seconds ?? 600) * 1000,
        regionCode: regionHint,
        bounty: payload.bounty,
      }).catch((err) =>
        console.error("[worker-api] Nostr publish failed:", err)
      );
    }

    return c.json(buildCreatedQueryPayload(query, getPublicRequestUrl(c)), 201);
  });

  app.get("/queries/:id/attachments", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);

    const query = getQueryById(id);
    if (!query) return c.json({ error: "Query not found" }, 404);

    const attachments = getPhotoProofAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have photo proof attachments" }, 404);

    const payloads = await Promise.all(
      attachments.map((attachment, index) => buildAttachmentPayload(query, attachment, index, getPublicRequestUrl(c))),
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

    return c.json(await buildAttachmentPayload(query, attachment, index, getPublicRequestUrl(c)));
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

    const stat = await statStoredAttachment(attachment, getPublicRequestUrl(c));
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

  app.get("/queries/:id/attachments/:index/preview", async (c) => {
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

    const maxDimensionParam = c.req.query("max_dimension");
    const maxDimension = maxDimensionParam ? Number(maxDimensionParam) : getRuntimeConfig().previewMaxDimension;
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      return c.json({ error: "max_dimension must be a positive number" }, 400);
    }

    const preview = await renderStoredAttachmentPreview(attachment, getPublicRequestUrl(c), {
      maxDimension: Math.floor(maxDimension),
    });
    if (!preview) {
      return c.json({ error: "Preview could not be generated" }, 422);
    }

    return new Response(Buffer.from(preview.data, "base64"), {
      headers: {
        "content-type": preview.mimeType,
        "content-length": String(preview.size),
        "cache-control": "public, max-age=3600",
      },
    });
  });

  const uploadHandler = async (c: Context) => {
    const unauthorized = requireWriteApiKey(c);
    if (unauthorized) return unauthorized;

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
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".mp4", ".mov", ".webm"];
    if (!allowed.includes(ext)) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    }

    const stored = await getAttachmentStore().put(id, file as File, getPublicRequestUrl(c));
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
    const unauthorized = requireWriteApiKey(c);
    if (unauthorized) return unauthorized;

    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const outcome = await submitQueryResult(id, body as QueryResult, {
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
    const unauthorized = requireWriteApiKey(c);
    if (unauthorized) return unauthorized;

    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const outcome = cancelQuery(id);
    return c.json(outcome, outcome.ok ? 200 : 400);
  };

  app.post("/queries/:id/cancel", cancelHandler);

  return app;
}
