/**
 * Individual MCP tool handler functions.
 */

import type { QueryInput, QueryResult } from "../application/query-service.ts";
import type { AttachmentRef, RequesterMeta, VerificationFactor, TlsnCondition } from "../domain/types.ts";
import type { McpQueryBackend } from "./mcp-query-backend.ts";

function normalizeMcpQueryResult(raw: Record<string, unknown>): QueryResult {
  const attachments = Array.isArray(raw.attachments) ? raw.attachments as AttachmentRef[] : [];
  const result: QueryResult = { attachments };
  if (typeof raw.notes === "string") result.notes = raw.notes;
  if (raw.gps && typeof raw.gps === "object") result.gps = raw.gps as QueryResult["gps"];
  if (raw.tlsn_attestation && typeof raw.tlsn_attestation === "object") {
    result.tlsn_attestation = raw.tlsn_attestation as QueryResult["tlsn_attestation"];
  }
  if (raw.tlsn_extension_result !== undefined) result.tlsn_extension_result = raw.tlsn_extension_result;
  return result;
}

interface CreateQueryArgs {
  description: string;
  location_hint?: string;
  ttl_seconds?: number;
  oracle_ids?: string[];
  verification_requirements?: VerificationFactor[];
  target_url?: string;
  target_method?: "GET" | "POST";
  conditions?: TlsnCondition[];
  visibility?: "public" | "requester_only";
}

type McpTextResult = { content: Array<{ type: "text"; text: string }> };
type McpMixedResult = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> };

export function buildRequesterMeta(): RequesterMeta {
  return {
    requester_type: "agent",
    client_name: Deno.env.get("REMOTE_QUERY_API_BASE_URL") ? "mcp-remote" : "mcp",
  };
}

export async function handleCreateQuery(
  backend: McpQueryBackend,
  args: CreateQueryArgs,
): Promise<McpTextResult> {
  const { description, location_hint, verification_requirements, target_url, target_method, conditions, ttl_seconds, oracle_ids, visibility } = args;
  const input: QueryInput = {
    description,
    location_hint,
    verification_requirements,
    tlsn_requirements: target_url ? {
      target_url,
      method: target_method,
      conditions,
    } : undefined,
    visibility,
  };
  const payload = await backend.createQuery(input, ttl_seconds ?? 600, buildRequesterMeta(), oracle_ids);
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleGetQueryStatus(
  backend: McpQueryBackend,
  queryId: string,
): Promise<McpTextResult> {
  const payload = await backend.getQueryStatus(queryId);
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleCancelQuery(
  backend: McpQueryBackend,
  queryId: string,
): Promise<McpTextResult> {
  const payload = await backend.cancelQuery(queryId);
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleListAvailableQueries(
  backend: McpQueryBackend,
): Promise<McpTextResult> {
  const payload = await backend.listAvailableQueries();
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleSubmitQueryResult(
  backend: McpQueryBackend,
  queryId: string,
  result: Record<string, unknown>,
  oracleId?: string,
): Promise<McpTextResult> {
  const payload = await backend.submitQueryResult(queryId, normalizeMcpQueryResult(result), oracleId);
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleGetQueryAttachment(
  backend: McpQueryBackend,
  queryId: string,
  attachmentIndex: number,
): Promise<McpTextResult> {
  const payload = await backend.getQueryAttachment(queryId, attachmentIndex);
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handleGetQueryAttachmentPreview(
  backend: McpQueryBackend,
  queryId: string,
  attachmentIndex: number,
  maxDimension?: number,
): Promise<McpMixedResult> {
  const preview = await backend.getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension);
  const content: McpMixedResult["content"] = [
    { type: "text", text: JSON.stringify(preview.payload, null, 2) },
  ];

  if (preview.image) {
    content.push({
      type: "image",
      data: preview.image.data,
      mimeType: preview.image.mimeType,
    });
  }

  return { content };
}
