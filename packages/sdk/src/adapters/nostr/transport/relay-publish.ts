/**
 * Relay publish hook — publishes new queries to Nostr relays.
 *
 * This is an infrastructure concern (Nostr protocol interaction),
 * injected into the application layer via QueryHooks.onCreated.
 */

import type { Query } from "../../../requests/domain/types.ts";
import { isNostrEnabled, publishEvent } from "./client.ts";
import { buildQueryRequestEvent } from "../events/event-builders.ts";
import { generateEphemeralIdentity } from "../crypto/identity.ts";

import { getLogger } from "../../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "relay"]);

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
    payment_lock: query.payment_lock?.escrow_token
      ? {
        mint: Deno.env.get("CASHU_MINT_URL") ?? "",
        token: query.payment_lock.escrow_token,
      }
      : undefined,
  }, query.location_hint);

  const MAX_RETRIES = 3;
  (async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await publishEvent(event);
      if (result.successes.length > 0) {
        log.error(
          `Query ${query.id} published to ${result.successes.length} relay(s)`,
        );
        return;
      }
      if (attempt < MAX_RETRIES) {
        const delaySec = attempt * 2;
        log.error(
          `Query ${query.id} publish failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delaySec}s...`,
        );
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }
    log.error(
      `Query ${query.id} failed to publish after ${MAX_RETRIES} attempts`,
    );
  })().catch((err) => {
    log.error("Failed to publish query:", err);
  });
}
