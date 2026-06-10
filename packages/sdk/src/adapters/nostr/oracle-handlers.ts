/**
 * Event handlers for the Oracle actor Nostr workflow.
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../../identity.ts";
import { parseOfferFeedbackEvent } from "@anchr/protocol/events";
import {
  type OracleResponsePayload,
  parseOracleResponsePayload,
} from "./events/events.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";

export interface WatchedQuery {
  queryId: string;
  queryEventId: string;
  customerPubkey: string;
  selectedProviderPubkey?: string;
  offeredProviders: Set<string>;
  subs: { close(): void }[];
}

export function buildQueryFromPayload(
  queryId: string,
  oraclePayload: OracleResponsePayload,
): Query {
  return {
    id: queryId,
    status: "processing",
    description: "",
    challenge_nonce: oraclePayload.nonce_echo,
    challenge_rule: "",
    verification_requirements: ["gps", "ai_check"],
    created_at: 0,
    expires_at: Date.now() + 600_000,
    payment_status: "escrow_swapped",
  };
}

export function buildResultFromPayload(
  oraclePayload: OracleResponsePayload,
): QueryResult {
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

export function parseResponsePayload(
  identity: NostrIdentity,
  event: Event,
): OracleResponsePayload | null {
  return parseOracleResponsePayload(event, identity.secretKey);
}
