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

// Re-export the kinds so consumers don't need to import nostr.ts just for these.
export { KIND_QUERY_FEEDBACK, KIND_QUERY_REQUEST, KIND_QUERY_RESPONSE };
