import { Buffer } from "node:buffer";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { spawn } from "../runtime/mod.ts";
import { uploadAttachment } from "./attachment-store";
import { materializeAttachmentRef } from "./attachments";
import { getRuntimeConfig } from "./config";
import { validateAttachmentUri } from "./url-validation";
import { haversineKm } from "./verification/exif-validation";
import { createQuerySchema, resultBodySchema } from "./worker-api-schemas";
import {
  buildAttachmentPayload,
  buildCreatedQueryPayload,
  getAttachmentRefs,
  getPublicRequestUrl,
  queryDetail,
  querySummary,
  renderStoredAttachmentPreview,
} from "./worker-api-presenters";
import type { QueryService, QueryInput, QueryResult } from "../application/query-service";
import type { PreimageStore } from "./cashu/preimage-store";
import type { AttachmentRef, BlossomKeyMap, HtlcInfo, QuorumConfig, QuoteInfo } from "../domain/types";

export interface RouteContext {
  svc: QueryService;
  pStore?: PreimageStore;
  doListOracles: () => ReturnType<typeof import("./oracle").listOracles>;
  writeAuth: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
}

// deno-lint-ignore no-explicit-any
function handleListQueries(c: Context<any>, svc: QueryService) {
  const latParam = c.req.query("lat");
  const lonParam = c.req.query("lon");
  const maxDistParam = c.req.query("max_distance_km");

  let queries = svc.listOpenQueries();

  if (latParam && lonParam) {
    const workerLat = parseFloat(latParam);
    const workerLon = parseFloat(lonParam);
    if (!Number.isFinite(workerLat) || !Number.isFinite(workerLon)) {
      return c.json({ error: "lat and lon must be valid numbers" }, 400);
    }
    const maxDist = maxDistParam ? parseFloat(maxDistParam) : 50;
    if (!Number.isFinite(maxDist) || maxDist <= 0) {
      return c.json({ error: "max_distance_km must be a positive number" }, 400);
    }

    queries = queries.filter((q) => {
      if (!q.expected_gps) return true;
      const queryMaxDist = q.max_gps_distance_km ?? maxDist;
      return haversineKm(workerLat, workerLon, q.expected_gps.lat, q.expected_gps.lon) <= queryMaxDist;
    });
  }

  return c.json(queries.map(querySummary));
}

// deno-lint-ignore no-explicit-any
function handleCreateQuery(c: Context<any>, svc: QueryService, getUrl: () => string) {
  const payload = c.req.valid("json" as never) as z.infer<typeof createQuerySchema>;

  const input: QueryInput = {
    description: payload.description,
    location_hint: payload.location_hint,
    expected_gps: payload.expected_gps,
    max_gps_distance_km: payload.max_gps_distance_km,
    verification_requirements: payload.verification_requirements,
    tlsn_requirements: payload.tlsn_requirements,
    visibility: payload.visibility,
  };

  try {
    const query = svc.createQuery(input, {
      ttlSeconds: payload.ttl_seconds,
      requesterMeta: payload.requester,
      bounty: payload.bounty,
      oracleIds: payload.oracle_ids,
      htlc: payload.htlc as HtlcInfo | undefined,
      quorum: payload.quorum as QuorumConfig | undefined,
    });

    return c.json(buildCreatedQueryPayload(query, getUrl()), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
}

export function registerQueryRoutes(app: Hono, ctx: RouteContext) {
  const { svc, writeAuth, rateLimit } = ctx;

  app.get("/queries", (c) => handleListQueries(c, svc));
  app.get("/queries/all", writeAuth, (c) => c.json(svc.listAllQueries().map(querySummary)));

  app.get("/queries/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = svc.getQuery(id);
    const requestUrl = getPublicRequestUrl(c);
    return query ? c.json(queryDetail(query, requestUrl)) : c.json({ error: "Query not found" }, 404);
  });

  app.post(
    "/queries",
    rateLimit,
    writeAuth,
    // deno-lint-ignore no-explicit-any -- Zod v4 ZodObject is not assignable to @hono/zod-validator's ZodSchema (Zod v3 type)
    zValidator("json", createQuerySchema as any, (result, c) => {
      if (!result.success) {
        return c.json({
          error: "Invalid query payload",
          issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        }, 400);
      }
    }) as unknown as MiddlewareHandler,
    (c) => handleCreateQuery(c, svc, () => getPublicRequestUrl(c)),
  );

  app.post("/queries/:id/submit", writeAuth, (c) => {
    return c.json({
      error: "Deprecated",
      hint: "All queries now require HTLC escrow. Use POST /queries/:id/result with the HTLC flow instead.",
    }, 410);
  });

  app.post("/queries/:id/cancel", writeAuth, (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const outcome = svc.cancelQuery(id);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });
}

function resolveIndexedAttachment(
  svc: QueryService,
  id: string | undefined,
  indexRaw: number,
): { error: string; status: number } | { query: ReturnType<QueryService["getQuery"]> & object; attachment: AttachmentRef; attachments: AttachmentRef[] } {
  if (!id) return { error: "Query id is required", status: 400 };
  if (!Number.isInteger(indexRaw) || indexRaw < 0) return { error: "Attachment index must be a non-negative integer", status: 400 };
  const query = svc.getQuery(id);
  if (!query) return { error: "Query not found", status: 404 };
  const attachments = getAttachmentRefs(query);
  if (!attachments) return { error: "Query does not have attachments", status: 404 };
  const attachment = attachments[indexRaw];
  if (!attachment) return { error: "Attachment not found", status: 404 };
  return { query, attachment, attachments };
}

// deno-lint-ignore no-explicit-any
async function handleAttachmentPreview(c: Context<any>, svc: QueryService) {
  const resolved = resolveIndexedAttachment(svc, c.req.param("id"), Number(c.req.param("index")));
  if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status as 400);
  const { attachment } = resolved;
  const maxDimensionParam = c.req.query("max_dimension");
  const maxDimension = maxDimensionParam ? Number(maxDimensionParam) : getRuntimeConfig().previewMaxDimension;
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return c.json({ error: "max_dimension must be a positive number" }, 400);
  const preview = await renderStoredAttachmentPreview(attachment, getPublicRequestUrl(c), { maxDimension: Math.floor(maxDimension) });
  if (!preview) return c.json({ error: "Preview could not be generated" }, 422);
  return new Response(Buffer.from(preview.data, "base64"), {
    headers: { "content-type": preview.mimeType, "content-length": String(preview.size), "cache-control": "public, max-age=3600" },
  });
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".mp4", ".mov", ".webm", ".zip"];

// deno-lint-ignore no-explicit-any
async function handleUpload(c: Context<any>, svc: QueryService) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Query id is required" }, 400);

  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: `Upload too large: ${contentLength} bytes (max ${MAX_UPLOAD_BYTES})` }, 413);
  }

  const query = svc.getQuery(id);
  if (!query) return c.json({ error: "Query not found" }, 404);
  if (query.status !== "pending") return c.json({ error: "Query not pending" }, 409);
  let formData: FormData;
  try { formData = await c.req.formData(); } catch { return c.json({ error: "Expected multipart/form-data" }, 400); }
  const file = formData.get("photo");
  if (!file || typeof file === "string") return c.json({ error: "Missing photo field" }, 400);

  if ((file as File).size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File too large: ${(file as File).size} bytes (max ${MAX_UPLOAD_BYTES})` }, 413);
  }

  const ext = (file as File).name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".jpg";
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) return c.json({ error: `Unsupported file type: ${ext}` }, 400);
  const result = await uploadAttachment(id, file as File, { expectedGps: query.expected_gps });
  return c.json({
    ok: true,
    attachment: materializeAttachmentRef(result.attachment, c.req.url),
    encryption: result.encryption,
  });
}

export function registerAttachmentRoutes(app: Hono, ctx: RouteContext) {
  const { svc, writeAuth, rateLimit } = ctx;

  app.get("/queries/:id/attachments", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = svc.getQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    const attachments = getAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have attachments" }, 404);
    const payloads = await Promise.all(
      attachments.map((att, i) => buildAttachmentPayload(query, att, i, getPublicRequestUrl(c))),
    );
    return c.json(payloads);
  });

  app.get("/queries/:id/attachments/:index/meta", async (c) => {
    const resolved = resolveIndexedAttachment(svc, c.req.param("id"), Number(c.req.param("index")));
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status as 400);
    return c.json(await buildAttachmentPayload(resolved.query, resolved.attachment, Number(c.req.param("index")), getPublicRequestUrl(c)));
  });

  app.get("/queries/:id/attachments/:index", async (c) => {
    const resolved = resolveIndexedAttachment(svc, c.req.param("id"), Number(c.req.param("index")));
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status as 400);
    const uriError = validateAttachmentUri(resolved.attachment.uri);
    if (uriError) return c.json({ error: `Invalid attachment URI: ${uriError}` }, 400);
    return c.redirect(resolved.attachment.uri, 302);
  });

  app.get("/queries/:id/attachments/:index/preview", (c) => handleAttachmentPreview(c, svc));
  app.post("/queries/:id/upload", rateLimit, writeAuth, (c) => handleUpload(c, svc));
}

function parseResultBody(rawBody: unknown): { error: string; issues?: Array<{ path: string; message: string }> } | z.infer<typeof resultBodySchema> {
  const parsed = resultBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      error: "Invalid result payload",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }
  return parsed.data;
}

function buildQueryResult(body: z.infer<typeof resultBodySchema>): { result: QueryResult; workerPubkey: string; blossomKeys: BlossomKeyMap | undefined; oracleId: string | undefined } {
  return {
    result: {
      attachments: body.attachments as AttachmentRef[],
      notes: body.notes,
      gps: body.gps,
      tlsn_attestation: body.tlsn_presentation
        ? { presentation: body.tlsn_presentation }
        : body.tlsn_attestation,
      tlsn_extension_result: body.tlsn_extension_result,
    },
    workerPubkey: body.worker_pubkey,
    blossomKeys: body.encryption_keys as BlossomKeyMap | undefined,
    oracleId: body.oracle_id,
  };
}

// deno-lint-ignore no-explicit-any
async function handleSubmitResult(c: Context<any>, svc: QueryService) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Query id is required" }, 400);
  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

  const parsed = parseResultBody(rawBody);
  if ("error" in parsed) return c.json(parsed, 400);

  const { result, workerPubkey, blossomKeys, oracleId } = buildQueryResult(parsed);

  const query = svc.getQuery(id);
  if (query?.htlc) {
    const htlcOutcome = await svc.submitHtlcResult(id, result, workerPubkey, oracleId, blossomKeys);
    const status = !htlcOutcome.query ? 404 : !htlcOutcome.ok ? 422 : 200;
    return c.json({
      ok: htlcOutcome.ok,
      message: htlcOutcome.message,
      verification: htlcOutcome.query?.verification,
      oracle_id: htlcOutcome.query?.assigned_oracle_id ?? null,
      payment_status: htlcOutcome.query?.payment_status,
      preimage: htlcOutcome.preimage ?? null,
    }, status);
  }

  const outcome = await svc.submitQueryResult(id, result, { executor_type: "human", channel: "worker_api" }, oracleId, blossomKeys);
  return c.json({
    ok: outcome.ok,
    message: outcome.message,
    verification: outcome.query?.verification,
    oracle_id: outcome.query?.assigned_oracle_id ?? null,
    payment_status: outcome.query?.payment_status,
  }, outcome.ok ? 200 : 400);
}

export function registerHtlcRoutes(app: Hono, ctx: RouteContext) {
  const { svc, pStore, writeAuth, rateLimit } = ctx;

  app.post("/hash", rateLimit, writeAuth, (c) => {
    if (!pStore) return c.json({ error: "Preimage store not configured" }, 500);
    const entry = pStore.create();
    return c.json({ hash: entry.hash });
  });

  app.get("/queries/:id/quotes", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = svc.getQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    return c.json(query.quotes ?? []);
  });

  app.post("/queries/:id/quotes", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: Record<string, unknown>;
    try { body = await c.req.json() as Record<string, unknown>; } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const workerPubkey = typeof body.worker_pubkey === "string" ? body.worker_pubkey : undefined;
    if (!workerPubkey) return c.json({ error: "worker_pubkey is required" }, 400);

    const quote: QuoteInfo = {
      worker_pubkey: workerPubkey,
      amount_sats: typeof body.amount_sats === "number" ? body.amount_sats : undefined,
      quote_event_id: typeof body.quote_event_id === "string" ? body.quote_event_id : "",
      received_at: Date.now(),
    };

    const outcome = svc.recordQuote(id, quote);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  app.post("/queries/:id/select", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: Record<string, unknown>;
    try { body = await c.req.json() as Record<string, unknown>; } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const workerPubkey = typeof body.worker_pubkey === "string" ? body.worker_pubkey : undefined;
    if (!workerPubkey) return c.json({ error: "worker_pubkey is required" }, 400);
    const htlcToken = typeof body.htlc_token === "string" ? body.htlc_token : undefined;

    const outcome = await svc.selectWorker(id, workerPubkey, htlcToken);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  app.post("/queries/:id/result", rateLimit, writeAuth, (c) => handleSubmitResult(c, svc));
}

function parseDockerLogLine(line: string): { service: string; message: string } {
  const match = line.match(/^(\S+)\s+\|\s+(.*)/);
  const service = match?.[1]
    ? match[1].replace(/^anchr-/, "").replace(/-\d+$/, "")
    : "docker";
  return { service, message: match?.[2] ?? line };
}

async function streamDockerLogs(
  send: (entry: { service: string; message: string; ts: number }) => void,
): Promise<ReturnType<typeof spawn>> {
  const dockerProc = spawn(
    ["docker", "compose", "logs", "-f", "--tail=30", "--no-color"],
    { stdout: "pipe", stderr: "pipe" },
  );

  const reader = (dockerProc.stdout as ReadableStream<Uint8Array>).getReader();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += new TextDecoder().decode(value);
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const { service, message } = parseDockerLogLine(line);
      send({ service, message, ts: Date.now() });
    }
  }

  return dockerProc;
}

export function registerLogRoutes(app: Hono, writeAuth: MiddlewareHandler) {
  app.get("/logs/stream", writeAuth, (c) => {
    let dockerProc: ReturnType<typeof spawn> | null = null;
    let unsubscribe: (() => void) | null = null;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (entry: { service: string; message: string; ts: number }) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
          } catch { /* client gone */ }
        };

        const { getRecentLogs, subscribeLog } = await import("./log-stream");
        for (const entry of getRecentLogs()) send(entry);
        unsubscribe = subscribeLog(send);

        try {
          dockerProc = await streamDockerLogs(send);
        } catch (err) {
          send({ service: "system", message: `Docker logs unavailable: ${err}`, ts: Date.now() });
        }

        controller.close();
      },
      cancel() {
        dockerProc?.kill();
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || (process.env.NODE_ENV === "production" ? "" : "*"),
      },
    });
  });
}
