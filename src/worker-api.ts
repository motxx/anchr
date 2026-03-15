import { join } from "node:path";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { uploadAttachment } from "./attachment-store";
import {
  buildAttachmentAbsoluteUrl,
  buildAttachmentHandle,
  materializeAttachmentRef,
  materializeQueryResult,
  renderStoredAttachmentPreview,
  statStoredAttachment,
} from "./attachments";
import { getRuntimeConfig } from "./config";
import { listOracles } from "./oracle";
import type { OracleRegistry } from "./oracle/registry";
import {
  cancelQuery,
  createQuery,
  defaultService as defaultQueryService,
  getQuery as getQueryById,
  listOpenQueries,
  submitQueryResult,
  type QueryInput,
  type QueryResult,
  type QueryService,
} from "./query-service";
import type { AttachmentRef, BlossomKeyMap, HtlcInfo, Query, QuoteInfo } from "./types";

export interface WorkerApiDeps {
  queryService?: QueryService;
  oracleRegistry?: OracleRegistry;
}

// --- Schemas ---

const requesterMetaSchema = z.object({
  requester_type: z.enum(["agent", "human", "app"]),
  requester_id: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
});

const bountySchema = z.object({
  amount_sats: z.number().int().min(1),
  cashu_token: z.string().min(1).optional(),
});

const oracleIdsSchema = z.array(z.string().min(1)).optional();

const htlcSchema = z.object({
  hash: z.string().min(1),
  oracle_pubkey: z.string().min(1),
  requester_pubkey: z.string().min(1),
  locktime: z.number().int().min(0),
  escrow_token: z.string().min(1).optional(),
}).optional();

const gpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).optional();

const createQuerySchema = z.object({
  description: z.string().min(1),
  location_hint: z.string().min(1).optional(),
  expected_gps: gpsSchema,
  ttl_seconds: z.number().int().min(60).max(86_400).optional(),
  requester: requesterMetaSchema.optional(),
  bounty: bountySchema.optional(),
  oracle_ids: oracleIdsSchema,
  htlc: htlcSchema,
});

// --- Auth Middleware ---

function extractApiKey(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
  }
  return c.req.header("x-api-key")?.trim() || null;
}

const writeAuth: MiddlewareHandler = async (c, next) => {
  const { httpApiKeys } = getRuntimeConfig();
  if (httpApiKeys.length === 0) return next();

  const supplied = extractApiKey(c);
  if (supplied && httpApiKeys.includes(supplied)) return next();

  return c.json(
    { error: "Unauthorized", hint: "Set Authorization: Bearer <key> or X-API-Key: <key> to access write endpoints." },
    401,
    { "www-authenticate": "Bearer" },
  );
};

// --- Presenters ---

function getPublicRequestUrl(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || c.req.header("host")?.trim();
  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  if (host) url.host = host;
  return url.toString();
}

function querySummary(query: Query) {
  return {
    id: query.id,
    status: query.status,
    description: query.description,
    location_hint: query.location_hint ?? null,
    requester_meta: query.requester_meta ?? null,
    bounty: query.bounty ? { amount_sats: query.bounty.amount_sats } : null,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    oracle_ids: query.oracle_ids ?? null,
    expires_at: query.expires_at,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
    htlc: query.htlc ? {
      hash: query.htlc.hash,
      oracle_pubkey: query.htlc.oracle_pubkey,
      worker_pubkey: query.htlc.worker_pubkey ?? null,
      locktime: query.htlc.locktime,
    } : null,
    quotes_count: query.quotes?.length ?? 0,
    expected_gps: query.expected_gps ?? null,
  };
}

function buildCreatedQueryPayload(query: Query, requestUrl: string) {
  const requestOrigin = new URL(requestUrl).origin;
  return {
    query_id: query.id,
    status: query.status,
    description: query.description,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${requestOrigin}/queries/${query.id}`,
    query_api_url: `${requestOrigin}/queries/${query.id}`,
    payment_status: query.payment_status,
    htlc: query.htlc ? { hash: query.htlc.hash, oracle_pubkey: query.htlc.oracle_pubkey } : null,
  };
}

function queryDetail(query: Query, requestUrl: string) {
  return {
    ...querySummary(query),
    created_at: query.created_at,
    submitted_at: query.submitted_at,
    assigned_oracle_id: query.assigned_oracle_id ?? null,
    result: query.result ? materializeQueryResult(query.result, requestUrl) : undefined,
    verification: query.verification,
    submission_meta: query.submission_meta,
    payment_status: query.payment_status,
    blossom_keys: query.blossom_keys ?? null,
  };
}

function getAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (!query.result?.attachments?.length) return null;
  return query.result.attachments;
}

async function buildAttachmentPayload(query: Query, attachment: AttachmentRef, index: number, requestUrl: string) {
  const stat = await statStoredAttachment(attachment, requestUrl);
  const handle = buildAttachmentHandle(query.id, index, attachment, requestUrl);
  return {
    query_id: query.id,
    attachment_index: index,
    attachment: handle.attachment,
    access: {
      ...handle.access,
      preview_url: handle.access.preview_url ?? undefined,
    },
    attachment_view_url: handle.access.view_url,
    attachment_meta_url: handle.access.meta_url,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachment, requestUrl),
    storage_kind: stat?.storageKind ?? handle.attachment.storage_kind,
    // Blossom stores encrypted blobs; prefer the original mime_type from AttachmentRef (E2E: no keys exposed)
    mime_type: handle.attachment.storage_kind === "blossom" ? handle.attachment.mime_type : (stat?.mimeType ?? handle.attachment.mime_type),
    size_bytes: stat?.size ?? handle.attachment.size_bytes ?? null,
  };
}

// --- CSS Build ---

async function buildCss(cssIn: string, cssOut: string, label: string) {
  const proc = Bun.spawn([process.execPath, "x", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error(`[css-build:${label}] Failed:`, await new Response(proc.stderr).text());
  }
}

export async function prepareWorkerApiAssets() {
  await Promise.all([
    buildCss(join(import.meta.dir, "ui/globals.css"), join(import.meta.dir, "ui/generated.css"), "worker"),
    buildCss(join(import.meta.dir, "ui/requester/globals.css"), join(import.meta.dir, "ui/requester/generated.css"), "requester"),
  ]);
}

// --- Routes ---

export function buildWorkerApiApp(deps?: WorkerApiDeps) {
  const svc = deps?.queryService ?? defaultQueryService;
  const doCreateQuery = svc.createQuery.bind(svc);
  const doGetQuery = svc.getQuery.bind(svc);
  const doListOpen = svc.listOpenQueries.bind(svc);
  const doSubmit = svc.submitQueryResult.bind(svc);
  const doCancel = svc.cancelQuery.bind(svc);
  const doListOracles = deps?.oracleRegistry ? () => deps.oracleRegistry!.list() : listOracles;

  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/oracles", (c) => c.json(doListOracles()));

  app.get("/queries", (c) => c.json(doListOpen().map(querySummary)));

  app.get("/queries/all", (c) => c.json(svc.listAllQueries().map(querySummary)));

  app.get("/queries/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = doGetQuery(id);
    const requestUrl = getPublicRequestUrl(c);
    return query ? c.json(queryDetail(query, requestUrl)) : c.json({ error: "Query not found" }, 404);
  });

  app.post(
    "/queries",
    writeAuth,
    zValidator("json", createQuerySchema, (result, c) => {
      if (!result.success) {
        return c.json({
          error: "Invalid query payload",
          issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        }, 400);
      }
    }),
    (c) => {
      const payload = c.req.valid("json");

      const input: QueryInput = {
        description: payload.description,
        location_hint: payload.location_hint,
        expected_gps: payload.expected_gps,
      };

      const query = doCreateQuery(input, {
        ttlSeconds: payload.ttl_seconds,
        requesterMeta: payload.requester,
        bounty: payload.bounty,
        oracleIds: payload.oracle_ids,
        htlc: payload.htlc as HtlcInfo | undefined,
      });

      return c.json(buildCreatedQueryPayload(query, getPublicRequestUrl(c)), 201);
    },
  );

  app.get("/queries/:id/attachments", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    const attachments = getAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have attachments" }, 404);
    const payloads = await Promise.all(
      attachments.map((att, i) => buildAttachmentPayload(query, att, i, getPublicRequestUrl(c))),
    );
    return c.json(payloads);
  });

  app.get("/queries/:id/attachments/:index/meta", async (c) => {
    const id = c.req.param("id");
    const index = Number(c.req.param("index"));
    if (!id) return c.json({ error: "Query id is required" }, 400);
    if (!Number.isInteger(index) || index < 0) return c.json({ error: "Attachment index must be a non-negative integer" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    const attachments = getAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have attachments" }, 404);
    const attachment = attachments[index];
    if (!attachment) return c.json({ error: "Attachment not found" }, 404);
    return c.json(await buildAttachmentPayload(query, attachment, index, getPublicRequestUrl(c)));
  });

  app.get("/queries/:id/attachments/:index", async (c) => {
    const id = c.req.param("id");
    const index = Number(c.req.param("index"));
    if (!id) return c.json({ error: "Query id is required" }, 400);
    if (!Number.isInteger(index) || index < 0) return c.json({ error: "Attachment index must be a non-negative integer" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    const attachments = getAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have attachments" }, 404);
    const attachment = attachments[index];
    if (!attachment) return c.json({ error: "Attachment not found" }, 404);

    // All attachments are stored on Blossom (encrypted). Redirect to the blob URL.
    // Clients must decrypt using keys obtained via NIP-44 encrypted Nostr events.
    return c.redirect(attachment.uri, 302);
  });

  app.get("/queries/:id/attachments/:index/preview", async (c) => {
    const id = c.req.param("id");
    const index = Number(c.req.param("index"));
    if (!id) return c.json({ error: "Query id is required" }, 400);
    if (!Number.isInteger(index) || index < 0) return c.json({ error: "Attachment index must be a non-negative integer" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    const attachments = getAttachmentRefs(query);
    if (!attachments) return c.json({ error: "Query does not have attachments" }, 404);
    const attachment = attachments[index];
    if (!attachment) return c.json({ error: "Attachment not found" }, 404);
    const maxDimensionParam = c.req.query("max_dimension");
    const maxDimension = maxDimensionParam ? Number(maxDimensionParam) : getRuntimeConfig().previewMaxDimension;
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) return c.json({ error: "max_dimension must be a positive number" }, 400);
    const preview = await renderStoredAttachmentPreview(attachment, getPublicRequestUrl(c), { maxDimension: Math.floor(maxDimension) });
    if (!preview) return c.json({ error: "Preview could not be generated" }, 422);
    return new Response(Buffer.from(preview.data, "base64"), {
      headers: { "content-type": preview.mimeType, "content-length": String(preview.size), "cache-control": "public, max-age=3600" },
    });
  });

  app.post("/queries/:id/upload", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    if (query.status !== "pending") return c.json({ error: "Query not pending" }, 409);
    let formData: FormData;
    try { formData = await c.req.formData(); } catch { return c.json({ error: "Expected multipart/form-data" }, 400); }
    const file = formData.get("photo");
    if (!file || typeof file === "string") return c.json({ error: "Missing photo field" }, 400);
    const ext = (file as File).name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".jpg";
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".mp4", ".mov", ".webm", ".zip"];
    if (!allowed.includes(ext)) return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    const result = await uploadAttachment(id, file as File, { expectedGps: query.expected_gps });
    return c.json({
      ok: true,
      attachment: materializeAttachmentRef(result.attachment, c.req.url),
      // E2E: encryption keys returned once, never persisted on server
      encryption: result.encryption,
    });
  });

  app.post("/queries/:id/submit", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: Record<string, unknown>;
    try { body = await c.req.json() as Record<string, unknown>; } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const oracleId = typeof body.oracle_id === "string" ? body.oracle_id : undefined;
    // E2E: accept ephemeral encryption keys for one-time oracle verification
    const blossomKeys = body.encryption_keys as BlossomKeyMap | undefined;
    const outcome = await doSubmit(id, body as unknown as QueryResult, { executor_type: "human", channel: "worker_api" }, oracleId, blossomKeys);
    const status = !outcome.query ? 404
      : !outcome.ok && outcome.query.status !== "pending" && outcome.query.status !== "rejected" ? 409
      : outcome.ok ? 200 : 422;
    return c.json({
      ok: outcome.ok,
      message: outcome.message,
      verification: outcome.query?.verification,
      oracle_id: outcome.query?.assigned_oracle_id ?? null,
      payment_status: outcome.query?.payment_status,
    }, status);
  });

  app.post("/queries/:id/cancel", writeAuth, (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const outcome = doCancel(id);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  // --- HTLC lifecycle endpoints ---

  app.get("/queries/:id/quotes", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    const query = doGetQuery(id);
    if (!query) return c.json({ error: "Query not found" }, 404);
    return c.json(query.quotes ?? []);
  });

  app.post("/queries/:id/quotes", writeAuth, async (c) => {
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

    const outcome = svc.selectWorker(id, workerPubkey, htlcToken);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  app.post("/queries/:id/result", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Query id is required" }, 400);
    let body: Record<string, unknown>;
    try { body = await c.req.json() as Record<string, unknown>; } catch { return c.json({ error: "Invalid JSON" }, 400); }

    const workerPubkey = typeof body.worker_pubkey === "string" ? body.worker_pubkey : undefined;
    if (!workerPubkey) return c.json({ error: "worker_pubkey is required" }, 400);

    const result: QueryResult = {
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      notes: typeof body.notes === "string" ? body.notes : undefined,
    };
    const blossomKeys = body.encryption_keys as BlossomKeyMap | undefined;

    const outcome = svc.recordResult(id, result, workerPubkey, blossomKeys);
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  return app;
}
