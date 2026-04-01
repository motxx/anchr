/**
 * Requester service — orchestrates the Requester's side of the HTLC flow.
 *
 * Per README:
 *   1. Request hash(preimage) from Oracle
 *   2. Lock Cashu HTLC token (Worker TBD)
 *   3. Publish DVM Job Request (kind 5300) with Oracle pubkey
 *   4. Listen for Worker quotes (kind 7000 status=payment-required)
 *   5. Select Worker, swap HTLC to add Worker pubkey
 *   6. Announce selection (kind 7000 status=processing)
 *   7. Receive result (kind 6300), download blob, decrypt K_R
 */

import type { Proof } from "@cashu/cashu-ts";
import type { Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/pool";
import type { NostrIdentity } from "../infrastructure/nostr/identity";
import { generateEphemeralIdentity } from "../infrastructure/nostr/identity";
import {
  buildQueryRequestEvent,
  buildSelectionFeedbackEvent,
  parseFeedbackPayload,
  parseQueryResponsePayload,
  type QueryRequestPayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
} from "../infrastructure/nostr/events";
import { publishEvent, subscribeToFeedback, subscribeToResponses } from "../infrastructure/nostr/client";
import {
  createHtlcToken,
  swapHtlcBindWorker,
  type EscrowToken,
} from "../infrastructure/cashu/escrow";
import type { HtlcInfo, QuoteInfo, TlsnEncryptedContext } from "../domain/types";

export interface RequesterConfig {
  /** Oracle endpoint URL (for HTTP-based hash request). */
  oracleEndpoint?: string;
  /** Oracle API key. */
  oracleApiKey?: string;
  /** Oracle's Nostr pubkey (hex). */
  oraclePubkey: string;
  /** Relay URLs. */
  relayUrls?: string[];
}

export interface CreateQueryRequest {
  description: string;
  locationHint?: string;
  ttlSeconds?: number;
  amountSats: number;
  /** Source Cashu proofs for the bounty. */
  sourceProofs: Proof[];
  /** Locktime in seconds from now. */
  locktimeSeconds?: number;
}

export interface RequesterQueryState {
  queryId: string;
  identity: NostrIdentity;
  htlc: HtlcInfo;
  initialToken: EscrowToken;
  nostrEventId: string;
  quotes: QuoteInfo[];
  selectedWorkerPubkey?: string;
  finalToken?: EscrowToken;
}

/**
 * Step 1: Request hash(preimage) from Oracle via HTTP.
 */
export async function requestOracleHash(
  queryId: string,
  oracleEndpoint: string,
  oracleApiKey?: string,
): Promise<{ hash: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (oracleApiKey) headers["authorization"] = `Bearer ${oracleApiKey}`;

  const res = await fetch(`${oracleEndpoint}/hash`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query_id: queryId }),
  });

  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Oracle /hash failed: ${res.status}`);
  }
  const data = await res.json() as { hash: string };
  return { hash: data.hash };
}

/**
 * Steps 1-3: Create a query with HTLC escrow and publish to Nostr.
 */
export async function createHtlcQuery(
  config: RequesterConfig,
  request: CreateQueryRequest,
): Promise<RequesterQueryState | null> {
  const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const identity = generateEphemeralIdentity();
  const locktimeSeconds = request.locktimeSeconds ?? 3600;
  const locktime = Math.floor(Date.now() / 1000) + locktimeSeconds;

  // Step 1: Get hash from Oracle
  let hash: string;
  if (config.oracleEndpoint) {
    const result = await requestOracleHash(queryId, config.oracleEndpoint, config.oracleApiKey);
    hash = result.hash;
  } else {
    throw new Error("Oracle endpoint is required for HTLC flow");
  }

  // Step 2: Lock HTLC token (Worker TBD)
  const initialToken = await createHtlcToken(
    request.amountSats,
    {
      hash,
      requesterPubkey: identity.publicKey,
      locktimeSeconds: locktime,
    },
    request.sourceProofs,
  );
  if (!initialToken) return null;

  // Step 3: Publish DVM Job Request (kind 5300)
  const payload: QueryRequestPayload = {
    description: request.description,
    nonce: "", // Will be set by query-service
    oracle_pubkey: config.oraclePubkey,
    requester_pubkey: identity.publicKey,
    bounty: {
      mint: process.env.CASHU_MINT_URL ?? "",
      token: initialToken.token,
    },
    expires_at: Date.now() + (request.ttlSeconds ?? 600) * 1000,
  };

  const event = buildQueryRequestEvent(
    identity,
    queryId,
    payload,
    request.locationHint,
  );

  const publishResult = await publishEvent(event, config.relayUrls);
  if (publishResult.successes.length === 0) {
    console.error("[requester] Failed to publish query to any relay");
  }

  const htlc: HtlcInfo = {
    hash,
    oracle_pubkey: config.oraclePubkey,
    requester_pubkey: identity.publicKey,
    locktime,
    escrow_token: initialToken.token,
  };

  return {
    queryId,
    identity,
    htlc,
    initialToken,
    nostrEventId: event.id,
    quotes: [],
  };
}

/**
 * Step 4: Listen for Worker quotes.
 */
export function subscribeToQuotes(
  state: RequesterQueryState,
  onQuote: (quote: QuoteInfo) => void,
  relayUrls?: string[],
): SubCloser {
  return subscribeToFeedback(
    state.nostrEventId,
    (event: Event) => {
      try {
        const payload = parseFeedbackPayload(
          event.content,
          state.identity.secretKey,
          event.pubkey,
        );
        if (payload.status === "payment-required") {
          const quote = payload as QuoteFeedbackPayload;
          const info: QuoteInfo = {
            worker_pubkey: quote.worker_pubkey,
            amount_sats: quote.amount_sats,
            quote_event_id: event.id,
            received_at: Date.now(),
          };
          state.quotes.push(info);
          onQuote(info);
        }
      } catch {
        // Cannot decrypt, not for us
      }
    },
    relayUrls,
  );
}

/**
 * Steps 5-6: Select a Worker and announce selection.
 */
export async function selectWorker(
  state: RequesterQueryState,
  workerPubkey: string,
  relayUrls?: string[],
  encryptedContext?: TlsnEncryptedContext,
): Promise<EscrowToken | null> {
  // Step 5: Swap HTLC to bind Worker
  const finalToken = await swapHtlcBindWorker(
    state.initialToken.proofs,
    {
      hash: state.htlc.hash,
      workerPubkey,
      requesterRefundPubkey: state.htlc.requester_pubkey,
      locktimeSeconds: state.htlc.locktime,
    },
  );
  if (!finalToken) return null;

  state.selectedWorkerPubkey = workerPubkey;
  state.finalToken = finalToken;
  state.htlc.worker_pubkey = workerPubkey;
  state.htlc.escrow_token = finalToken.token;

  // Step 6: Announce selection (kind 7000 status=processing)
  const selectionPayload: SelectionFeedbackPayload = {
    status: "processing",
    selected_worker_pubkey: workerPubkey,
    htlc_token: finalToken.token,
    encrypted_context: encryptedContext,
  };

  const event = buildSelectionFeedbackEvent(
    state.identity,
    state.nostrEventId,
    workerPubkey,
    selectionPayload,
  );

  await publishEvent(event, relayUrls);
  return finalToken;
}
