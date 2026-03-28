/**
 * Worker service — orchestrates the Worker's side of the HTLC flow.
 *
 * Per README:
 *   1. Subscribe to kind 5300 queries, verify Oracle pubkey against whitelist
 *   2. Send quote (kind 7000 status=payment-required)
 *   3. Wait for selection (kind 7000 status=processing), verify own pubkey
 *   4. Verify own pubkey is in HTLC condition on Cashu Mint
 *   5. Photograph on-site, C2PA sign, EXIF strip
 *   6. Generate K, encrypt blob, encrypt K→K_R (Requester) + K→K_O (Oracle)
 *   7. Upload encrypted blob to Blossom
 *   8. Publish DVM Job Result (kind 6300)
 *   9. Wait for preimage via NIP-44 DM (kind 4) from Oracle
 *  10. Redeem HTLC with preimage + Worker signature
 */

import type { Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/pool";
import type { TlsnEncryptedContext } from "./types";
import type { NostrIdentity } from "./nostr/identity";
import { generateEphemeralIdentity } from "./nostr/identity";
import {
  buildQuoteFeedbackEvent,
  buildQueryResponseEvent,
  parseQueryRequestPayload,
  parseFeedbackPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
} from "./nostr/events";
import { parseOracleDM, type OracleDMPayload } from "./nostr/dm";
import {
  publishEvent,
  subscribeToQueries,
  subscribeToFeedback,
  subscribeToDMs,
} from "./nostr/client";
import { encryptNip44, deriveConversationKey } from "./nostr/encryption";
import { workerUpload, type WorkerUploadResult } from "./blossom/worker-upload";
import type { BlossomUploadResult } from "./blossom/client";

export interface WorkerConfig {
  /** Trusted Oracle pubkeys. Queries from unknown Oracles are ignored. */
  trustedOraclePubkeys: string[];
  /** Relay URLs. */
  relayUrls?: string[];
  /** Blossom server URLs. */
  blossomServerUrls?: string[];
}

export interface DiscoveredQuery {
  eventId: string;
  pubkey: string;
  payload: QueryRequestPayload;
  oraclePubkey?: string;
  requesterPubkey?: string;
}

export interface WorkerQueryState {
  identity: NostrIdentity;
  query: DiscoveredQuery;
  selected: boolean;
  htlcToken?: string;
  preimage?: string;
}

/**
 * Step 1: Discover queries from the relay, filtering by trusted Oracle pubkeys.
 */
export function discoverQueries(
  config: WorkerConfig,
  onQuery: (query: DiscoveredQuery) => void,
  regionCode?: string,
): SubCloser {
  return subscribeToQueries(
    (event: Event) => {
      try {
        const payload = parseQueryRequestPayload(event.content);

        // Verify Oracle pubkey against whitelist
        if (payload.oracle_pubkey && !config.trustedOraclePubkeys.includes(payload.oracle_pubkey)) {
          return; // Unknown Oracle, skip
        }

        const oracleTag = event.tags.find((t) => t[0] === "p" && t[3] === "oracle");

        onQuery({
          eventId: event.id,
          pubkey: event.pubkey,
          payload,
          oraclePubkey: payload.oracle_pubkey ?? oracleTag?.[1],
          requesterPubkey: payload.requester_pubkey ?? event.pubkey,
        });
      } catch {
        // Malformed event, ignore
      }
    },
    { regionCode, relayUrls: config.relayUrls },
  );
}

/**
 * Step 2: Submit a quote for a discovered query.
 */
export async function submitQuote(
  identity: NostrIdentity,
  query: DiscoveredQuery,
  amountSats?: number,
  relayUrls?: string[],
): Promise<string> {
  const payload: QuoteFeedbackPayload = {
    status: "payment-required",
    worker_pubkey: identity.publicKey,
    amount_sats: amountSats,
  };

  const event = buildQuoteFeedbackEvent(
    identity,
    query.eventId,
    query.requesterPubkey ?? query.pubkey,
    payload,
  );

  await publishEvent(event, relayUrls);
  return event.id;
}

/**
 * Step 3: Wait for selection announcement.
 */
export function waitForSelection(
  identity: NostrIdentity,
  query: DiscoveredQuery,
  onSelected: (htlcToken?: string, encryptedContext?: TlsnEncryptedContext) => void,
  onRejected: () => void,
  relayUrls?: string[],
): SubCloser {
  return subscribeToFeedback(
    query.eventId,
    (event: Event) => {
      try {
        const payload = parseFeedbackPayload(
          event.content,
          identity.secretKey,
          event.pubkey,
        );

        if (payload.status === "processing") {
          const selection = payload as SelectionFeedbackPayload;
          if (selection.selected_worker_pubkey === identity.publicKey) {
            onSelected(selection.htlc_token, selection.encrypted_context);
          } else {
            // Another Worker was selected
            onRejected();
          }
        }
      } catch {
        // Cannot decrypt or parse, ignore
      }
    },
    relayUrls,
  );
}

/**
 * Steps 6-7: Encrypt blob with dual keys and upload to Blossom.
 *
 * Generates symmetric key K, encrypts blob with K (AES-256-GCM),
 * then encrypts K with Requester pubkey (K_R) and Oracle pubkey (K_O)
 * using NIP-44.
 */
export async function encryptAndUpload(
  identity: NostrIdentity,
  data: Uint8Array,
  filename: string,
  mimeType: string,
  requesterPubkey: string,
  oraclePubkey: string,
  blossomServerUrls?: string[],
): Promise<{
  upload: WorkerUploadResult;
  kR: string; // K encrypted to Requester (NIP-44)
  kO: string; // K encrypted to Oracle (NIP-44)
} | null> {
  // Upload to Blossom (EXIF strip + AES-256-GCM encrypt)
  const upload = await workerUpload(data, filename, mimeType, {
    serverUrls: blossomServerUrls,
  });
  if (!upload) return null;

  // Encrypt the symmetric key K to Requester (K_R) and Oracle (K_O) using NIP-44
  const keyMaterial = JSON.stringify({
    key: upload.blossom.encryptKey,
    iv: upload.blossom.encryptIv,
  });

  const requesterConvKey = deriveConversationKey(identity.secretKey, requesterPubkey);
  const kR = encryptNip44(keyMaterial, requesterConvKey);

  const oracleConvKey = deriveConversationKey(identity.secretKey, oraclePubkey);
  const kO = encryptNip44(keyMaterial, oracleConvKey);

  return { upload, kR, kO };
}

/**
 * Step 8: Publish DVM Job Result (kind 6300).
 */
export async function publishResult(
  identity: NostrIdentity,
  query: DiscoveredQuery,
  upload: WorkerUploadResult,
  kR: string,
  kO: string,
  nonce: string,
  notes?: string,
  relayUrls?: string[],
): Promise<string> {
  const payload: QueryResponsePayload = {
    nonce_echo: nonce,
    attachments: [{
      blossom_hash: upload.blossom.hash,
      blossom_urls: upload.blossom.urls,
      decrypt_key_requester: kR,
      decrypt_key_oracle: kO,
      decrypt_iv: upload.blossom.encryptIv,
      mime: upload.attachment.mime_type,
    }],
    notes,
  };

  const event = buildQueryResponseEvent(
    identity,
    query.eventId,
    query.requesterPubkey ?? query.pubkey,
    payload,
    query.oraclePubkey,
  );

  await publishEvent(event, relayUrls);
  return event.id;
}

/**
 * Step 9: Wait for preimage delivery from Oracle via NIP-44 DM.
 */
export function waitForPreimage(
  identity: NostrIdentity,
  oraclePubkey: string,
  queryId: string,
  onPreimage: (preimage: string) => void,
  onRejection: (reason: string) => void,
  relayUrls?: string[],
): SubCloser {
  return subscribeToDMs(
    identity.publicKey,
    (event: Event) => {
      // Only accept DMs from the Oracle
      if (event.pubkey !== oraclePubkey) return;

      try {
        const payload: OracleDMPayload = parseOracleDM(
          event.content,
          identity.secretKey,
          event.pubkey,
        );

        if (payload.query_id !== queryId) return;

        if (payload.type === "preimage") {
          onPreimage(payload.preimage);
        } else if (payload.type === "rejection") {
          onRejection(payload.reason);
        }
      } catch {
        // Cannot decrypt, not for us
      }
    },
    relayUrls,
  );
}
