/**
 * Anchr Nostr protocol layer (NIP-90 DVM compatible).
 *
 * Provides decentralized query distribution and encrypted
 * communication over the Nostr relay network using NIP-90
 * Data Vending Machine event kinds (5300/6300/7000).
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
  subscribeToAttestations,
  fetchRecentQueries,
  isNostrEnabled,
  getNostrConfig,
  closePool,
} from "./client";
export {
  GT_ORACLE_ATTESTATION,
  buildOracleAttestationEvent,
  parseOracleAttestationPayload,
  toOracleAttestation,
  type OracleAttestationPayload,
} from "./oracle-attestation";
export {
  publishQueryToNostr,
  listenForQueries,
  type NostrQueryHandle,
  type NostrQueryOptions,
  type NostrWorkerHandle,
} from "./query-bridge";
export {
  createNostrQuery,
  getNostrQuery,
  listNostrQueries,
  cancelNostrQuery,
  verifyAndSettle,
  expireNostrQueries,
  activeQueryCount,
} from "./nostr-query-service";
