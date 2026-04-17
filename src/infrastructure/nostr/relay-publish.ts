/**
 * Relay publish hook — publishes new queries to Nostr relays.
 *
 * This is an infrastructure concern (Nostr protocol interaction),
 * injected into the application layer via QueryHooks.onCreated.
 */

import type { Query } from "../../domain/types";
import { isNostrEnabled, publishEvent } from "./client";
import { buildQueryRequestEvent } from "./event-builders";
import { generateEphemeralIdentity } from "./identity";

/**
 * Publish a newly created query to configured Nostr relays.
 * Designed to be used as a QueryHooks.onCreated callback.
 */
export function publishQueryToRelay(query: Query): void {
  if (!isNostrEnabled()) return;

  const identity = generateEphemeralIdentity();
  const event = buildQueryRequestEvent(identity, query.id, {
    description: query.description,
    nonce: query.challenge_nonce,
    expires_at: query.expires_at,
    oracle_ids: query.oracle_ids,
    verification_requirements: query.verification_requirements,
    bounty: query.bounty?.escrow_token
      ? { mint: process.env.CASHU_MINT_URL ?? "", token: query.bounty.escrow_token }
      : undefined,
  }, query.location_hint);

  const MAX_RETRIES = 3;
  (async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await publishEvent(event);
      if (result.successes.length > 0) {
        console.error(`[relay] Query ${query.id} published to ${result.successes.length} relay(s)`);
        return;
      }
      if (attempt < MAX_RETRIES) {
        const delaySec = attempt * 2;
        console.error(`[relay] Query ${query.id} publish failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delaySec}s...`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }
    console.error(`[relay] Query ${query.id} failed to publish after ${MAX_RETRIES} attempts`);
  })().catch((err) => {
    console.error("[relay] Failed to publish query:", err);
  });
}
