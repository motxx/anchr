/**
 * Nostr adapter public surface (explicit export list).
 *
 * Oracle-service ownership: this module owns the **relay-DM Oracle daemon**
 * (`createOracleNostrService` — watches requests on relays, verifies, and
 * delivers Release Material as NIP-44 DMs). The **FROST peer server** is a
 * separate single-purpose owner at `@anchr/sdk/adapters/oracle-service`
 * (`buildOracleApp` — FROST signer/DKG routes). Neither re-exports the other.
 */

export { createRelayClient } from "./client.ts";
export type {
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "../types.ts";
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
  buildOracleAttestationEvent,
  type OracleAttestationPayload,
  parseOracleAttestationPayload,
  toOracleAttestation,
} from "./events/oracle-attestation.ts";
export {
  createOracleNostrService,
  createOracleNostrServiceFromEnv,
} from "./oracle-service.ts";
export type {
  OracleNostrService,
  OracleNostrServiceConfig,
} from "./oracle-service.ts";
