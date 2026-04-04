/**
 * Event handlers for the Oracle Nostr service.
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../nostr/identity";
import {
  parseOracleResponsePayload,
  parseFeedbackPayload,
  type QuoteFeedbackPayload,
  type OracleResponsePayload,
} from "../nostr/events";
import type { Query, QueryResult } from "../../domain/types";

export interface WatchedQuery {
  queryId: string;
  queryEventId: string;
  requesterPubkey: string;
  selectedWorkerPubkey?: string;
  quotedWorkers: Set<string>;
  subs: import("nostr-tools/pool").SubCloser[];
}

export function buildQueryFromPayload(queryId: string, oraclePayload: OracleResponsePayload): Query {
  return {
    id: queryId,
    status: "processing",
    description: "",
    challenge_nonce: oraclePayload.nonce_echo,
    challenge_rule: "",
    verification_requirements: ["gps", "ai_check"],
    created_at: 0,
    expires_at: Date.now() + 600_000,
    payment_status: "htlc_swapped",
  };
}

export function buildResultFromPayload(oraclePayload: OracleResponsePayload): QueryResult {
  return {
    attachments: (oraclePayload.attachments ?? []).map((a) => ({
      id: a.blossom_hash,
      uri: a.blossom_urls[0] ?? "",
      mime_type: a.mime,
      storage_kind: "blossom" as const,
      blossom_hash: a.blossom_hash,
      blossom_servers: a.blossom_urls,
    })),
    notes: oraclePayload.notes,
  };
}

export function handleFeedbackEvent(
  identity: NostrIdentity,
  watched: Map<string, WatchedQuery>,
  queryId: string,
  event: Event,
  onQuote?: (queryId: string, workerPubkey: string, amountSats?: number) => void,
): void {
  const entry = watched.get(queryId);
  if (!entry) return;

  try {
    const payload = parseFeedbackPayload(
      event.content,
      identity.secretKey,
      event.pubkey,
    );

    if (payload.status === "payment-required") {
      const quote = payload as QuoteFeedbackPayload;
      entry.quotedWorkers.add(quote.worker_pubkey);
      onQuote?.(queryId, quote.worker_pubkey, quote.amount_sats);
    }
  } catch {
    // Cannot decrypt — event not for us, ignore
  }
}

export function parseResponsePayload(
  identity: NostrIdentity,
  event: Event,
): OracleResponsePayload | null {
  return parseOracleResponsePayload(event, identity.secretKey);
}
