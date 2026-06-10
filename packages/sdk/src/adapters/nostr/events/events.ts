/**
 * SDK-local DVM-dialect payload shapes (not the canonical wire contract).
 *
 * The canonical Anchr wire contract lives in `@anchr/protocol/events`.
 * This module carries the generic NIP-90 DVM dialect spoken by the SDK's
 * Nostr service layer so DVM-aware clients can discover and interact with
 * Anchr queries; kinds come from `@anchr/protocol/nostr`.
 *
 * Kind 7000 is used for multiple sub-types per NIP-90:
 *   status=payment-required  → Provider offer
 *   status=processing        → Provider selection announcement
 *   status=success/error     → Completion feedback
 */

import type {
  TlsnEncryptedContext,
  VerificationFactor,
} from "../../../requests/domain/types.ts";
import { decryptNip44, deriveConversationKey } from "../crypto/encryption.ts";

// --- Payload types ---

export interface DvmQueryRequestPayload {
  description: string;
  nonce?: string;
  /** Oracle's Nostr pubkey (hex) — Providers verify against whitelist. */
  oracle_pubkey?: string;
  /** Customer's Nostr pubkey (hex) — Providers encrypt K_R to this. */
  customer_pubkey?: string;
  payment_lock?: {
    mint: string;
    token: string;
  };
  oracle_ids?: string[];
  /** Verification factors requested by the Customer. */
  verification_requirements?: readonly VerificationFactor[];
  expires_at: number;
}

export interface DvmQueryResponsePayload {
  nonce_echo: string;
  attachments?: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    /** Symmetric key encrypted to Customer pubkey (NIP-44). */
    decrypt_key_customer?: string;
    /** Symmetric key encrypted to Oracle pubkey (NIP-44). */
    decrypt_key_oracle?: string;
    /** IV for AES-256-GCM decryption (hex). */
    decrypt_iv: string;
    mime: string;
  }>;
  notes?: string;
}

/** Provider offer: kind 7000 with status=payment-required. */
export interface DvmOfferFeedbackPayload {
  status: "payment-required";
  /** Provider's Nostr pubkey (hex). */
  provider_pubkey: string;
  /** Requested amount in sats. */
  amount_sats?: number;
}

/** Customer selection announcement: kind 7000 with status=processing. */
export interface DvmSelectionFeedbackPayload {
  status: "processing";
  /** Selected Provider's Nostr pubkey (hex). */
  selected_provider_pubkey: string;
  /** HTLC token (swapped to include Provider pubkey). */
  htlc_token?: string;
  /** Sensitive TLSNotary context for proof generation (target_url, headers).
   *  Delivered only to the selected Provider via NIP-44 encrypted kind 7000 event. */
  encrypted_context?: TlsnEncryptedContext;
}

/** Completion feedback: kind 7000 with status=success or error. */
export interface CompletionFeedbackPayload {
  status: "success" | "error";
  reason?: string;
  escrow_token?: string;
}

/** Settlement payload published as kind KIND_QUERY_FEEDBACK. */
export interface QuerySettlementPayload {
  status: "accepted" | "rejected";
  escrow_token?: string;
  reason?: string;
}

/** Union of all kind 7000 feedback payload types. */
export type FeedbackPayload =
  | DvmOfferFeedbackPayload
  | DvmSelectionFeedbackPayload
  | CompletionFeedbackPayload
  | QuerySettlementPayload;

/** Preimage delivery via NIP-44 DM (kind 4). */
export interface PreimageDMPayload {
  type: "preimage";
  query_id: string;
  preimage: string;
}

/** Rejection notice via NIP-44 DM (kind 4). */
export interface RejectionDMPayload {
  type: "rejection";
  query_id: string;
  reason: string;
}

/** FROST group signature delivery via NIP-44 DM (kind 4). */
export interface FrostSignatureDMPayload {
  type: "frost_signature";
  query_id: string;
  /** BIP-340 Schnorr signature hex (from FROST threshold signing). */
  group_signature: string;
  /** FROST group public key for verification. */
  group_pubkey: string;
}

export type OracleDMPayload =
  | PreimageDMPayload
  | RejectionDMPayload
  | FrostSignatureDMPayload;

/**
 * Oracle-accessible payload embedded in kind 6300 tags.
 * Encrypted to Oracle via NIP-44 so only Oracle can read it.
 */
export interface OracleResponsePayload {
  nonce_echo: string;
  attachments: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    decrypt_key_oracle: string;
    decrypt_iv: string;
    mime: string;
  }>;
  notes?: string;
}

// --- Event builders (delegated to event-builders.ts) ---

export {
  buildOfferFeedbackEvent,
  buildOracleAnnouncementEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  buildSelectionFeedbackEvent,
} from "./event-builders.ts";

// --- Parsers ---

export function parseQueryRequestPayload(
  content: string,
): DvmQueryRequestPayload {
  return JSON.parse(content) as DvmQueryRequestPayload;
}

export function parseQueryResponsePayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): DvmQueryResponsePayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as DvmQueryResponsePayload;
}

export function parseOracleResponsePayload(
  event: { tags: string[][]; pubkey: string },
  oracleSecretKey: Uint8Array,
): OracleResponsePayload | null {
  const oracleTag = event.tags.find((t) => t[0] === "oracle_payload" && t[1]);
  if (!oracleTag) return null;

  const conversationKey = deriveConversationKey(oracleSecretKey, event.pubkey);
  const decrypted = decryptNip44(oracleTag[1]!, conversationKey);
  return JSON.parse(decrypted) as OracleResponsePayload;
}

export function parseQuerySettlementPayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): QuerySettlementPayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as QuerySettlementPayload;
}

export function parseFeedbackPayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): FeedbackPayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as FeedbackPayload;
}
