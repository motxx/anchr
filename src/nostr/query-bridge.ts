/**
 * Query Bridge: connects the existing QueryService with the Nostr protocol layer.
 *
 * Requester side: Creates queries via Nostr events, monitors for responses
 * Worker side: Listens for query events, submits responses via Nostr
 *
 * This bridge allows the existing HTTP API and MCP tools to work alongside
 * the Nostr protocol. When NOSTR_RELAYS is configured, queries are also
 * published to Nostr in addition to the local SQLite store.
 */

import type { Event } from "nostr-tools/core";
import type { SubCloser } from "nostr-tools/pool";
import { generateNonce } from "../challenge";
import { isCashuEnabled } from "../cashu/wallet";
import type { QueryInput, BountyInfo } from "../types";
import {
  publishEvent,
  subscribeToQueries,
  subscribeToResponses,
  isNostrEnabled,
} from "./client";
import { generateEphemeralIdentity, type NostrIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuerySettlementPayload,
} from "./events";

export interface NostrQueryOptions {
  regionCode?: string;
  bounty?: BountyInfo;
  oracleIds?: string[];
  ttlMs?: number;
  relayUrls?: string[];
}

export interface NostrQueryHandle {
  queryId: string;
  nostrEventId: string;
  identity: NostrIdentity;
  nonce: string;
  subscribeResponses: (
    onResponse: (response: QueryResponsePayload, workerPubKey: string, eventId: string) => void,
  ) => SubCloser;
  settleQuery: (
    responseEventId: string,
    workerPubKey: string,
    settlement: QuerySettlementPayload,
  ) => Promise<void>;
}

/**
 * Publish a query to Nostr relays (requester side).
 *
 * Returns a handle that can be used to subscribe to responses
 * and settle the query.
 */
export async function publishQueryToNostr(
  input: QueryInput,
  options?: NostrQueryOptions,
): Promise<NostrQueryHandle | null> {
  if (!isNostrEnabled()) return null;

  const identity = generateEphemeralIdentity();
  const nonce = generateNonce();
  const queryId = `gt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const payload: QueryRequestPayload = {
    type: input.type,
    params: input as unknown as Record<string, unknown>,
    nonce,
    expires_at: Date.now() + (options?.ttlMs ?? 600_000),
  };

  if (options?.bounty && isCashuEnabled()) {
    payload.bounty = {
      mint: process.env.CASHU_MINT_URL!,
      token: options.bounty.cashu_token ?? "",
    };
  }

  if (options?.oracleIds?.length) {
    payload.oracle_ids = options.oracleIds;
  }

  const event = buildQueryRequestEvent(
    identity,
    queryId,
    payload,
    options?.regionCode,
  );

  const result = await publishEvent(event, options?.relayUrls);

  if (result.successes.length === 0) {
    console.error("[nostr-bridge] Failed to publish to any relay:", result.failures);
    return null;
  }

  console.error(
    `[nostr-bridge] Query ${queryId} published to ${result.successes.length} relay(s)`,
  );

  return {
    queryId,
    nostrEventId: event.id,
    identity,
    nonce,

    subscribeResponses(onResponse) {
      return subscribeToResponses(event.id, (responseEvent: Event) => {
        try {
          const responsePayload = parseQueryResponsePayload(
            responseEvent.content,
            identity.secretKey,
            responseEvent.pubkey,
          );
          onResponse(responsePayload, responseEvent.pubkey, responseEvent.id);
        } catch (err) {
          console.error("[nostr-bridge] Failed to decrypt response:", err);
        }
      }, options?.relayUrls);
    },

    async settleQuery(responseEventId, workerPubKey, settlement) {
      const settlementEvent = buildQuerySettlementEvent(
        identity,
        event.id,
        responseEventId,
        workerPubKey,
        settlement,
      );
      await publishEvent(settlementEvent, options?.relayUrls);
    },
  };
}

export interface NostrWorkerHandle {
  subscription: SubCloser;
  stop: () => void;
}

/**
 * Listen for query requests on Nostr (worker side).
 *
 * When a query is received, the callback is invoked with the query details.
 * The worker can then submit a response via the returned respond function.
 */
export function listenForQueries(
  onQuery: (query: {
    queryId: string;
    eventId: string;
    requesterPubKey: string;
    payload: QueryRequestPayload;
    respond: (response: QueryResponsePayload) => Promise<void>;
  }) => void,
  options?: {
    regionCode?: string;
    relayUrls?: string[];
  },
): NostrWorkerHandle {
  const workerIdentity = generateEphemeralIdentity();

  const subscription = subscribeToQueries((event: Event) => {
    try {
      const payload = parseQueryRequestPayload(event.content);
      const queryId = event.tags.find((t) => t[0] === "d")?.[1] ?? event.id;

      onQuery({
        queryId,
        eventId: event.id,
        requesterPubKey: event.pubkey,
        payload,
        async respond(response: QueryResponsePayload) {
          const responseEvent = buildQueryResponseEvent(
            workerIdentity,
            event.id,
            event.pubkey,
            response,
          );
          await publishEvent(responseEvent, options?.relayUrls);
        },
      });
    } catch (err) {
      console.error("[nostr-bridge] Failed to parse query event:", err);
    }
  }, options);

  return {
    subscription,
    stop() {
      subscription.close();
    },
  };
}
