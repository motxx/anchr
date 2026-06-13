/**
 * Event handlers for the Oracle actor Nostr workflow.
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../../identity.ts";
import { parseOfferFeedbackEvent } from "@anchr/protocol/events";
import type { OracleQueryResponsePayload } from "@anchr/protocol/events";
import type { AttachmentRef, GpsCoord } from "../../values.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";

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

function parseGps(value: unknown): GpsCoord | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.lat !== "number" || typeof value.lon !== "number") {
    return undefined;
  }
  return { lat: value.lat, lon: value.lon };
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
 * the verifier consumes. `data` carries the evidence fields (`attachments`,
 * `gps`, `notes`); a TLSN query reads the base64 presentation from `proof`.
 * Malformed fields are dropped, so verification fails closed on whatever
 * evidence the requirement demands but the payload does not carry.
 */
export function oracleResponseToResult(
  query: Query,
  payload: OracleQueryResponsePayload,
): QueryResult {
  const data = isRecord(payload.data) ? payload.data : {};

  const attachments: AttachmentRef[] = [];
  if (Array.isArray(data.attachments)) {
    for (const entry of data.attachments) {
      const ref = parseAttachment(entry);
      if (ref !== null) attachments.push(ref);
    }
  }

  const result: QueryResult = { attachments };
  const gps = parseGps(data.gps);
  if (gps !== undefined) result.gps = gps;
  if (typeof data.notes === "string") result.notes = data.notes;

  const wantsTlsn = query.verification_requirements.includes("tlsn") ||
    query.schema_requirement !== undefined;
  if (
    wantsTlsn && typeof payload.proof === "string" && payload.proof.length > 0
  ) {
    result.schema_evidence = { presentation: payload.proof };
  }
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
