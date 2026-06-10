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
} from "../../identity.ts";
export {
  decryptNip44,
  deriveConversationKey,
  deriveRegionKey,
  encryptNip44,
  regionKeyHex,
} from "./crypto/encryption.ts";
export { buildOracleAnnouncementEvent } from "./events/events.ts";
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
  buildOracleAttestationEvent,
  type OracleAttestationPayload,
  parseOracleAttestationPayload,
  toOracleAttestation,
} from "./events/oracle-attestation.ts";
