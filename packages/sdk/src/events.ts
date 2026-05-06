/**
 * Anchr event payload builders / parsers.
 *
 * The SDK uses NIP-90 DVM kinds (5300 / 6300 / 7000) but defines its
 * own payload shape inside the event content. This module isolates the
 * wire format so Customer / Provider both reference the same builders.
 */

import {
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  KIND_QUERY_FEEDBACK,
  signEvent,
  type Event,
  type Keypair,
} from "./nostr.ts";

/**
 * Plaintext payload published in the content of a kind 5300 Job
 * Request event. Schema-specific predicates ride along under
 * `spec.predicate` — the SDK does not interpret them.
 */
export interface QueryRequestPayload {
  /** Caller-chosen unique query id (SHOULD match the `d` tag). */
  query_id: string;
  /** Schema URI identifying the proof format. */
  schema: string;
  /** Schema-specific predicate. */
  predicate: unknown;
  /** Optional human-readable description of intent. */
  description?: string;
  /** Hex pubkey of the customer (ephemeral; refund recipient). */
  customer_pubkey: string;
  /** Hex pubkey of the oracle the customer designated for this query. */
  oracle_pubkey: string;
  /** Cashu mint URL. */
  mint_url: string;
  /** The Phase-1 HTLC bounty token (provider unbound until quote selection). */
  bounty_token: string;
  /** Maximum amount the customer will pay (sats). */
  max_amount_sats: number;
  /** Locktime as Unix timestamp (seconds). */
  locktime_seconds: number;
  /** Unix timestamp (ms) after which the customer no longer accepts quotes. */
  expires_at: number;
}

/**
 * Build a signed kind 5300 Job Request event for the given payload.
 *
 * Tag layout:
 *   - d:        query_id (NIP-33 addressable)
 *   - t:        "anchr" (discovery tag)
 *   - p:        oracle pubkey (NIP-90 marker "oracle")
 *   - schema:   schema URI (custom tag, indexable as #schema)
 *
 * The content carries the JSON payload above.
 */
export function buildQueryRequestEvent(
  identity: Keypair,
  payload: QueryRequestPayload,
): Event {
  const tags: string[][] = [
    ["d", payload.query_id],
    ["t", "anchr"],
    ["p", payload.oracle_pubkey, "", "oracle"],
    ["schema", payload.schema],
  ];

  return signEvent(
    {
      kind: KIND_QUERY_REQUEST,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(payload),
      tags,
    },
    identity.secretKey,
  );
}

/**
 * Parse a kind 5300 Job Request event back into its payload.
 *
 * Returns null if the event content is not valid JSON or does not
 * carry the expected fields. Callers MUST handle the null case (it
 * means the event was published by someone speaking a different
 * payload format and should be ignored).
 */
export function parseQueryRequestEvent(event: Event): QueryRequestPayload | null {
  if (event.kind !== KIND_QUERY_REQUEST) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.query_id !== "string" ||
    typeof p.schema !== "string" ||
    typeof p.customer_pubkey !== "string" ||
    typeof p.oracle_pubkey !== "string" ||
    typeof p.mint_url !== "string" ||
    typeof p.bounty_token !== "string" ||
    typeof p.max_amount_sats !== "number" ||
    typeof p.locktime_seconds !== "number" ||
    typeof p.expires_at !== "number"
  ) {
    return null;
  }
  return {
    query_id: p.query_id,
    schema: p.schema,
    predicate: p.predicate,
    description: typeof p.description === "string" ? p.description : undefined,
    customer_pubkey: p.customer_pubkey,
    oracle_pubkey: p.oracle_pubkey,
    mint_url: p.mint_url,
    bounty_token: p.bounty_token,
    max_amount_sats: p.max_amount_sats,
    locktime_seconds: p.locktime_seconds,
    expires_at: p.expires_at,
  };
}

/** Plaintext payload published by a provider quoting on a request (NIP-90 kind 7000, status=payment-required). */
export interface QuoteFeedbackPayload {
  status: "payment-required";
  /** Provider's hex pubkey (must match the event's pubkey). */
  provider_pubkey: string;
  /** Amount in sats the provider asks for. */
  amount_sats: number;
}

/** Build a signed kind 7000 quote event referencing the request event. */
export function buildQuoteFeedbackEvent(
  identity: Keypair,
  requestEventId: string,
  customerPubkey: string,
  payload: QuoteFeedbackPayload,
): Event {
  const tags: string[][] = [
    ["e", requestEventId, "", "request"],
    ["p", customerPubkey],
    ["status", payload.status],
  ];
  return signEvent(
    {
      kind: KIND_QUERY_FEEDBACK,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(payload),
      tags,
    },
    identity.secretKey,
  );
}

/** Parse a kind 7000 quote payload. Returns null if the event is not a quote. */
export function parseQuoteFeedbackEvent(event: Event): QuoteFeedbackPayload | null {
  if (event.kind !== KIND_QUERY_FEEDBACK) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (
    p.status !== "payment-required" ||
    typeof p.provider_pubkey !== "string" ||
    typeof p.amount_sats !== "number"
  ) {
    return null;
  }
  if (p.provider_pubkey !== event.pubkey) return null;
  return {
    status: "payment-required",
    provider_pubkey: p.provider_pubkey,
    amount_sats: p.amount_sats,
  };
}

/** Plaintext payload published by a customer announcing the selected provider (NIP-90 kind 7000, status=processing). */
export interface SelectionFeedbackPayload {
  status: "processing";
  /** Hex pubkey of the selected provider. */
  selected_provider_pubkey: string;
  /** Phase-2 HTLC token now bound to the selected provider. */
  bound_token: string;
}

/** Build a signed kind 7000 selection event addressed to the chosen provider. */
export function buildSelectionFeedbackEvent(
  identity: Keypair,
  requestEventId: string,
  payload: SelectionFeedbackPayload,
): Event {
  const tags: string[][] = [
    ["e", requestEventId, "", "request"],
    ["p", payload.selected_provider_pubkey],
    ["status", payload.status],
  ];
  return signEvent(
    {
      kind: KIND_QUERY_FEEDBACK,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(payload),
      tags,
    },
    identity.secretKey,
  );
}

/** Parse a kind 7000 selection payload. Returns null on malformed input. */
export function parseSelectionFeedbackEvent(event: Event): SelectionFeedbackPayload | null {
  if (event.kind !== KIND_QUERY_FEEDBACK) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (
    p.status !== "processing" ||
    typeof p.selected_provider_pubkey !== "string" ||
    typeof p.bound_token !== "string"
  ) {
    return null;
  }
  return {
    status: "processing",
    selected_provider_pubkey: p.selected_provider_pubkey,
    bound_token: p.bound_token,
  };
}

import { decryptNip44, encryptNip44 } from "./nostr.ts";

/** Plaintext payload that travels NIP-44-encrypted in the NIP-90 kind 6300 result content. */
export interface QueryResponsePayload {
  /** Schema URI under which the proof was produced. */
  schema: string;
  /** Verified response payload (shape defined by the schema). */
  data: unknown;
  /** Proof bytes (format defined by the schema). Encoded as base64 or hex by the schema. */
  proof: Uint8Array | string;
}

/**
 * Build a signed kind 6300 result event. The content is NIP-44 v2-
 * encrypted to the customer's pubkey so only the customer can read it.
 *
 * @param identity - the provider's keypair
 * @param requestEventId - id of the customer's kind 5300 request event
 * @param customerPubkey - recipient pubkey for NIP-44 encryption
 * @param payload - QueryResponsePayload to deliver
 */
export function buildQueryResponseEvent(
  identity: Keypair,
  requestEventId: string,
  customerPubkey: string,
  payload: QueryResponsePayload,
): Event {
  const proofForJson = payload.proof instanceof Uint8Array
    ? base64Encode(payload.proof)
    : payload.proof;
  const plaintext = JSON.stringify({
    schema: payload.schema,
    data: payload.data,
    proof: proofForJson,
  });
  const ciphertext = encryptNip44(plaintext, identity.secretKey, customerPubkey);
  const tags: string[][] = [
    ["e", requestEventId, "", "request"],
    ["p", customerPubkey],
  ];
  return signEvent(
    {
      kind: KIND_QUERY_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      content: ciphertext,
      tags,
    },
    identity.secretKey,
  );
}

/**
 * Decrypt + parse a kind 6300 result event. Returns null if decryption
 * fails (event was not encrypted to us) or the payload shape is wrong.
 */
export function parseQueryResponseEvent(
  event: Event,
  recipientSecretKey: Uint8Array,
  senderPubkey: string,
): QueryResponsePayload | null {
  if (event.kind !== KIND_QUERY_RESPONSE) return null;
  let plaintext: string;
  try {
    plaintext = decryptNip44(event.content, recipientSecretKey, senderPubkey);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.schema !== "string" ||
    !("data" in p) ||
    typeof p.proof !== "string"
  ) {
    return null;
  }
  return {
    schema: p.schema,
    data: p.data,
    proof: p.proof,
  };
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

import { KIND_DIRECT_MESSAGE } from "./nostr.ts";

/** Plaintext payload that travels NIP-44-encrypted in the NIP-04 kind 4 DM content. */
export interface PreimageDeliveryPayload {
  /** Matches the request's query_id (anti-replay). */
  query_id: string;
  /** Original kind 5300 event id this preimage is for. */
  request_event_id: string;
  /** Hex preimage `S` such that `sha256(S) = H` (the customer's hashlock). */
  preimage: string;
}

/**
 * Build a signed kind 4 NIP-44 DM carrying a preimage from the oracle
 * to the selected provider. The recipient is in the `p` tag.
 */
export function buildPreimageDeliveryEvent(
  identity: Keypair,
  recipientPubkey: string,
  payload: PreimageDeliveryPayload,
): Event {
  const ciphertext = encryptNip44(JSON.stringify(payload), identity.secretKey, recipientPubkey);
  const tags: string[][] = [["p", recipientPubkey]];
  return signEvent(
    {
      kind: KIND_DIRECT_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      content: ciphertext,
      tags,
    },
    identity.secretKey,
  );
}

/**
 * Decrypt + parse a kind 4 NIP-44 DM expected to carry a preimage.
 * Returns null if decryption fails (DM not for us) or shape is wrong.
 */
export function parsePreimageDeliveryEvent(
  event: Event,
  recipientSecretKey: Uint8Array,
  senderPubkey: string,
): PreimageDeliveryPayload | null {
  if (event.kind !== KIND_DIRECT_MESSAGE) return null;
  let plaintext: string;
  try {
    plaintext = decryptNip44(event.content, recipientSecretKey, senderPubkey);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.query_id !== "string" ||
    typeof p.request_event_id !== "string" ||
    typeof p.preimage !== "string"
  ) {
    return null;
  }
  return {
    query_id: p.query_id,
    request_event_id: p.request_event_id,
    preimage: p.preimage,
  };
}

export { KIND_QUERY_FEEDBACK, KIND_QUERY_REQUEST, KIND_QUERY_RESPONSE };
