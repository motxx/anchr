/**
 * Event handlers for the Oracle actor Nostr workflow.
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../../identity.ts";
import { parseOfferFeedbackEvent } from "@anchr/protocol/events";
import type { OracleQueryResponsePayload } from "@anchr/protocol/events";
import type { AttachmentRef } from "../../values.ts";
import { resolveSchemaEvidence } from "../../schema.ts";
import { ensureReferenceSchemaBundlesRegistered } from "../../proofs/verification/checks/registry.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";

const DEFAULT_QUERY_SCHEMA = "https://anchr-spec.org/spec/proof/photo/v1";

export interface WatchedQuery {
  /** The real request the Oracle verifies submissions against. */
  query: Query;
  queryEventId: string;
  customerPubkey: string;
  selectedProviderPubkey?: string;
  offeredProviders: Set<string>;
  subs: { close(): void }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAttachment(value: unknown): AttachmentRef | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.uri !== "string" ||
    typeof value.mime_type !== "string"
  ) {
    return null;
  }
  if (value.storage_kind !== "blossom" && value.storage_kind !== "external") {
    return null;
  }
  const ref: AttachmentRef = {
    id: value.id,
    uri: value.uri,
    mime_type: value.mime_type,
    storage_kind: value.storage_kind,
  };
  if (typeof value.filename === "string") ref.filename = value.filename;
  if (typeof value.size_bytes === "number") ref.size_bytes = value.size_bytes;
  if (typeof value.blossom_hash === "string") {
    ref.blossom_hash = value.blossom_hash;
  }
  if (
    Array.isArray(value.blossom_servers) &&
    value.blossom_servers.every((entry) => typeof entry === "string")
  ) {
    ref.blossom_servers = value.blossom_servers;
  }
  return ref;
}

/**
 * Map the canonical Oracle-readable result payload onto the evidence shape
 * the verifier consumes. `data` carries schema-owned evidence fields plus
 * shared attachment references.
 * Malformed fields are dropped, so verification fails closed on whatever
 * evidence the requirement demands but the payload does not carry.
 */
export function oracleResponseToResult(
  query: Query,
  payload: OracleQueryResponsePayload,
): QueryResult {
  ensureReferenceSchemaBundlesRegistered();
  const data = isRecord(payload.data) ? payload.data : {};

  const attachments: AttachmentRef[] = [];
  if (Array.isArray(data.attachments)) {
    for (const entry of data.attachments) {
      const ref = parseAttachment(entry);
      if (ref !== null) attachments.push(ref);
    }
  }

  const result: QueryResult = { attachments };
  if (typeof data.notes === "string") result.notes = data.notes;

  const schemaEvidence = resolveSchemaEvidence(
    query.schema ?? DEFAULT_QUERY_SCHEMA,
    {
      data,
      proof: payload.proof,
    },
  );
  if (schemaEvidence !== undefined) result.schema_evidence = schemaEvidence;
  return result;
}

export function handleFeedbackEvent(
  _identity: NostrIdentity,
  watched: Map<string, WatchedQuery>,
  queryId: string,
  event: Event,
  onOffer?: (
    queryId: string,
    providerPubkey: string,
    amountSats?: number,
  ) => void,
): void {
  const entry = watched.get(queryId);
  if (!entry) return;

  const offer = parseOfferFeedbackEvent(event);
  if (offer === null) return;
  entry.offeredProviders.add(offer.provider_pubkey);
  onOffer?.(queryId, offer.provider_pubkey, offer.amount_sats);
}
