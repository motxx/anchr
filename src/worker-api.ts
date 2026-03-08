import { join } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { getAttachmentStore } from "./attachment-store";
import { UPLOADS_DIR, materializeAttachmentRef } from "./attachments";
import {
  cancelQuery,
  getQuery as getQueryById,
  listOpenQueries,
  submitQueryResult,
  type Query,
  type QueryResult,
} from "./query-service";
import type { AttachmentRef, PhotoProofResult } from "./types";

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
  if (result.type !== "photo_proof") return result;

  const photoProof: PhotoProofResult = result;
  return {
    ...photoProof,
    type: result.type,
    attachments: photoProof.attachments.map((attachment) => materializeAttachmentRef(attachment, requestUrl)),
  };
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
