/**
 * Anchr Nostr protocol layer (NIP-90 DVM compatible).
 *
 * Provides decentralized query distribution and encrypted
 * communication over the Nostr relay network using NIP-90
 * Data Vending Machine event kinds (5300/6300/7000).
 */

export {
  generateEphemeralIdentity,
  type NostrIdentity,
  restoreIdentity,
} from "./crypto/identity.ts";
export {
  decryptNip44,
  deriveConversationKey,
  deriveRegionKey,
  encryptNip44,
  regionKeyHex,
} from "./crypto/encryption.ts";
export {
  ANCHR_MARKETPLACE_LISTING,
  ANCHR_ORACLE_ANNOUNCEMENT,
  ANCHR_QUERY_FEEDBACK,
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  buildOfferFeedbackEvent,
  buildOracleAnnouncementEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  buildSelectionFeedbackEvent,
  type CompletionFeedbackPayload,
  type FeedbackPayload,
  type OfferFeedbackPayload,
  type OracleDMPayload,
  parseFeedbackPayload,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  type PreimageDMPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuerySettlementPayload,
  type RejectionDMPayload,
  type SelectionFeedbackPayload,
} from "./events/events.ts";
export {
  buildPreimageDM,
  buildRejectionDM,
  DM_KIND,
  parseOracleDM,
} from "./events/dm.ts";
export {
  closePool,
  fetchRecentQueries,
  getNostrConfig,
  isNostrEnabled,
  publishEvent,
  subscribeToAttestations,
  subscribeToDMs,
  subscribeToFeedback,
  subscribeToQueries,
  subscribeToResponses,
  subscribeToSettlements,
} from "./transport/client.ts";
export {
  ANCHR_ORACLE_ATTESTATION,
  buildOracleAttestationEvent,
  type OracleAttestationPayload,
  parseOracleAttestationPayload,
  toOracleAttestation,
} from "./events/oracle-attestation.ts";
