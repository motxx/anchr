/**
 * Anchr Nostr protocol layer.
 *
 * Provides decentralized query distribution and encrypted
 * communication over the Nostr relay network.
 */

export { generateEphemeralIdentity, restoreIdentity, type NostrIdentity } from "./identity";
export {
  deriveRegionKey,
  deriveConversationKey,
  encryptNip44,
  decryptNip44,
  regionKeyHex,
} from "./encryption";
export {
  GT_QUERY_REQUEST,
  GT_QUERY_RESPONSE,
  GT_QUERY_SETTLEMENT,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuerySettlementPayload,
} from "./events";
export {
  publishEvent,
  subscribeToQueries,
  subscribeToResponses,
  subscribeToSettlements,
  fetchRecentQueries,
  isNostrEnabled,
  getNostrConfig,
  closePool,
} from "./client";
export {
  publishQueryToNostr,
  listenForQueries,
  type NostrQueryHandle,
  type NostrQueryOptions,
  type NostrWorkerHandle,
} from "./query-bridge";
