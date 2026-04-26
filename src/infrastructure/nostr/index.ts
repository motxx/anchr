/**
 * Anchr Nostr protocol layer (NIP-90 DVM compatible).
 *
 * Provides decentralized query distribution and encrypted
 * communication over the Nostr relay network using NIP-90
 * Data Vending Machine event kinds (5300/6300/7000).
 */

export { generateEphemeralIdentity, restoreIdentity, type NostrIdentity } from "./identity.ts";
export {
  deriveRegionKey,
  deriveConversationKey,
  encryptNip44,
  decryptNip44,
  regionKeyHex,
} from "./encryption.ts";
export {
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  ANCHR_QUERY_FEEDBACK,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseFeedbackPayload,
  parseQuerySettlementPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
  type CompletionFeedbackPayload,
  type QuerySettlementPayload,
  type FeedbackPayload,
  type PreimageDMPayload,
  type RejectionDMPayload,
  type OracleDMPayload,
} from "./events.ts";
export {
  DM_KIND,
  buildPreimageDM,
  buildRejectionDM,
  parseOracleDM,
} from "./dm.ts";
export {
  publishEvent,
  subscribeToQueries,
  subscribeToResponses,
  subscribeToSettlements,
  subscribeToFeedback,
  subscribeToDMs,
  subscribeToAttestations,
  fetchRecentQueries,
  isNostrEnabled,
  getNostrConfig,
  closePool,
} from "./client.ts";
export {
  ANCHR_ORACLE_ATTESTATION,
  buildOracleAttestationEvent,
  parseOracleAttestationPayload,
  toOracleAttestation,
  type OracleAttestationPayload,
} from "./oracle-attestation.ts";
