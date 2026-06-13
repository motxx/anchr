/**
 * Oracle-side responder for the relay-DM hash bootstrap (INV-08).
 *
 * Subscribes to NIP-44 kind 4 DMs addressed to the Oracle, answers
 * `hash_request` payloads with a `hash_response` DM, and stays idempotent
 * per query id so a retried request returns the same commitment.
 */

import {
  buildHashResponseEvent,
  parseHashRequestEvent,
} from "@anchr/protocol/events";
import { type Keypair, KIND_DIRECT_MESSAGE } from "@anchr/protocol/nostr";
import type { RelayClient, Subscription } from "../types.ts";
import { getLogger } from "../../internal/runtime/logger.ts";

const log = getLogger(["anchr", "oracle", "hash-responder"]);

export interface HashResponderOptions {
  /** Relay transport the responder listens and answers on. */
  relayClient: RelayClient;
  /** The Oracle's identity (DM recipient and response signer). */
  identity: Keypair;
  /** Issues the hash commitment for a query id (e.g. PreimageStore.create). */
  issueHash: (queryId: string) => string | Promise<string>;
}

/**
 * Start answering hash bootstrap DMs. Returns the subscription; `close()`
 * stops the responder.
 */
export function serveHashRequests(options: HashResponderOptions): Subscription {
  const issued = new Map<string, string>();

  return options.relayClient.subscribe(
    {
      kinds: [KIND_DIRECT_MESSAGE],
      "#p": [options.identity.publicKey],
    },
    async (event) => {
      try {
        const request = parseHashRequestEvent(
          event,
          options.identity.secretKey,
          event.pubkey,
        );
        if (request === null) return;

        let hash = issued.get(request.query_id);
        if (hash === undefined) {
          hash = await options.issueHash(request.query_id);
          issued.set(request.query_id, hash);
        }

        const response = buildHashResponseEvent(
          options.identity,
          event.pubkey,
          {
            type: "hash_response",
            query_id: request.query_id,
            hash,
          },
        );
        options.relayClient.publish(response).then((result) => {
          if (result.successes.length === 0) {
            log.error(
              `hash_response for ${request.query_id} accepted by no relay`,
            );
          }
        }, (err) => {
          log.error(`hash_response publish failed: ${err}`);
        });
      } catch (error) {
        log.error("hash_response handling failed", { error });
      }
    },
  );
}
