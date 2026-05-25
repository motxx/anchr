/**
 * Customer service — orchestrates the Customer's side of the escrow flow.
 *
 * Per README:
 *   1. Request hash(preimage) from Oracle
 *   2. Lock escrow token (Provider TBD)
 *   3. Publish DVM Job Request (kind 5300) with Oracle pubkey
 *   4. Listen for Provider offers (kind 7000 status=payment-required)
 *   5. Select Provider, swap escrow to add Provider pubkey
 *   6. Announce selection (kind 7000 status=processing)
 *   7. Receive result (kind 6300), download blob, decrypt K_R
 */

import type { Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/pool";
import type { NostrIdentity } from "./crypto/identity.ts";
import { generateEphemeralIdentity } from "./crypto/identity.ts";
import {
  buildQueryRequestEvent,
  buildSelectionFeedbackEvent,
  type OfferFeedbackPayload,
  parseFeedbackPayload,
  type QueryRequestPayload,
  type SelectionFeedbackPayload,
} from "./events/events.ts";
import { publishEvent, subscribeToFeedback } from "./transport/client.ts";
import type { EscrowProvider } from "../../requests/application/ports.ts";
import type {
  EscrowInfo,
  OfferInfo,
  TlsnEncryptedContext,
} from "../../requests/domain/types.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "customer"]);

export interface CustomerNostrConfig {
  /** Oracle endpoint URL (for HTTP-based hash request). */
  oracleEndpoint?: string;
  /** Oracle API key. */
  oracleApiKey?: string;
  /** Oracle's Nostr pubkey (hex). */
  oraclePubkey: string;
  /** Relay URLs. */
  relayUrls?: string[];
  /** Escrow provider for creating and managing escrow holds. */
  escrowProvider: EscrowProvider;
}

export interface CreatePaidRequestInput {
  description: string;
  locationHint?: string;
  ttlSeconds?: number;
  amountSats: number;
  /** Locktime in seconds from now. */
  locktimeSeconds?: number;
}

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CustomerRequestState {
  requestId: string;
  identity: NostrIdentity;
  escrow: EscrowInfo;
  escrowRef: string;
  nostrEventId: string;
  offers: OfferInfo[];
  selectedProviderPubkey?: string;
  finalEscrowRef?: string;
}

/**
 * Step 1: Request hash(preimage) from Oracle via HTTP.
 */
export async function requestOracleHash(
  requestId: string,
  oracleEndpoint: string,
  oracleApiKey?: string,
  fetchFn: FetchFn = fetch,
): Promise<{ hash: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (oracleApiKey) headers["authorization"] = `Bearer ${oracleApiKey}`;

  const res = await fetchFn(`${oracleEndpoint}/hash`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query_id: requestId }),
  });

  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Oracle /hash failed: ${res.status}`);
  }
  const data = await res.json() as { hash: string };
  return { hash: data.hash };
}

/**
 * Steps 1-3: Create a request with escrow and publish to Nostr.
 */
export async function createHtlcRequest(
  config: CustomerNostrConfig,
  request: CreatePaidRequestInput,
): Promise<CustomerRequestState | null> {
  const requestId = `query_${Date.now()}_${
    Math.random().toString(36).slice(2, 8)
  }`;
  const identity = generateEphemeralIdentity();
  const locktimeSeconds = request.locktimeSeconds ?? 3600;
  const locktime = Math.floor(Date.now() / 1000) + locktimeSeconds;

  // Step 1: Get hash from Oracle
  let hash: string;
  if (config.oracleEndpoint) {
    const result = await requestOracleHash(
      requestId,
      config.oracleEndpoint,
      config.oracleApiKey,
    );
    hash = result.hash;
  } else {
    throw new Error("Oracle endpoint is required for HTLC flow");
  }

  // Step 2: Lock escrow token (Provider TBD) via EscrowProvider
  const hold = await config.escrowProvider.createHold({
    amount_sats: request.amountSats,
    payment_hash: hash,
    expiry: locktime,
    customer_pubkey: identity.publicKey,
  });
  if (!hold) return null;

  // Step 3: Publish DVM Job Request (kind 5300)
  const payload: QueryRequestPayload = {
    description: request.description,
    nonce: "", // Will be set by query-service
    oracle_pubkey: config.oraclePubkey,
    customer_pubkey: identity.publicKey,
    bounty: {
      mint: Deno.env.get("CASHU_MINT_URL") ?? "",
      token: hold.escrow_ref,
    },
    expires_at: Date.now() + (request.ttlSeconds ?? 600) * 1000,
  };

  const event = buildQueryRequestEvent(
    identity,
    requestId,
    payload,
    request.locationHint,
  );

  const publishResult = await publishEvent(event, config.relayUrls);
  if (publishResult.successes.length === 0) {
    log.error("Failed to publish request to any relay");
  }

  const escrow: EscrowInfo = {
    type: "htlc",
    hash,
    oracle_pubkeys: [config.oraclePubkey],
    customer_pubkey: identity.publicKey,
    locktime,
    escrow_ref: hold.escrow_ref,
  };

  return {
    requestId,
    identity,
    escrow,
    escrowRef: hold.escrow_ref,
    nostrEventId: event.id,
    offers: [],
  };
}

/**
 * Step 4: Listen for Provider offers.
 */
export function subscribeToOffers(
  state: CustomerRequestState,
  onOffer: (offer: OfferInfo) => void,
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
          const offer = payload as OfferFeedbackPayload;
          const info: OfferInfo = {
            provider_pubkey: offer.provider_pubkey,
            amount_sats: offer.amount_sats,
            offer_event_id: event.id,
            received_at: Date.now(),
          };
          state.offers.push(info);
          onOffer(info);
        }
      } catch {
        // Cannot decrypt, not for us
      }
    },
    relayUrls,
  );
}

/**
 * Steps 5-6: Select a Provider and announce selection.
 */
export async function selectProvider(
  config: CustomerNostrConfig,
  state: CustomerRequestState,
  providerPubkey: string,
  relayUrls?: string[],
  encryptedContext?: TlsnEncryptedContext,
): Promise<string | null> {
  // Step 5: Swap escrow to bind Provider via EscrowProvider
  const bound = await config.escrowProvider.bindProvider(
    state.escrowRef,
    providerPubkey,
  );
  if (!bound) return null;

  state.selectedProviderPubkey = providerPubkey;
  state.finalEscrowRef = bound.escrow_ref;
  state.escrow.provider_pubkey = providerPubkey;
  state.escrow.escrow_ref = bound.escrow_ref;

  // Step 6: Announce selection (kind 7000 status=processing)
  const selectionPayload: SelectionFeedbackPayload = {
    status: "processing",
    selected_provider_pubkey: providerPubkey,
    htlc_token: bound.escrow_ref,
    encrypted_context: encryptedContext,
  };

  const event = buildSelectionFeedbackEvent(
    state.identity,
    state.nostrEventId,
    providerPubkey,
    selectionPayload,
  );

  await publishEvent(event, relayUrls);
  return bound.escrow_ref;
}
