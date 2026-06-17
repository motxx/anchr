/**
 * Quick Start: publish a Request Notice to a Nostr relay with
 * SDK-built events and read it back. One actor, one relay round trip.
 *
 * The Request Notice carries only public discovery fields (ADR 0002): no
 * predicate, payment material, or execution context travels here. Payment
 * locking and the full Customer/Provider/Oracle exchange are the
 * `paid-request-simulation` example's lesson.
 */

import {
  buildQueryRequestEvent,
  parseQueryRequestEvent,
  type QueryRequestPayload,
} from "@anchr/protocol/events";
import { generateKeypair, KIND_QUERY_REQUEST } from "@anchr/protocol/nostr";
import { ProofSchema } from "@anchr/sdk";
import type { RelayClient } from "@anchr/sdk";

export interface QuickStartResult {
  /** The query id published on the relay. */
  queryId: string;
  /** Nostr event id of the published Request Notice. */
  eventId: string;
  /** Relays that accepted the publish. */
  acceptedBy: string[];
  /** The Request Notice read back from the relay and parsed. */
  echoed: QueryRequestPayload;
}

export class QuickStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickStartError";
  }
}

/**
 * Publish a minimal Request Notice under a fresh ephemeral keypair, then
 * subscribe and wait until the relay echoes it back.
 */
export async function runQuickStart(
  relayClient: RelayClient,
  options: { timeoutMs?: number } = {},
): Promise<QuickStartResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const identity = generateKeypair();
  const oracle = generateKeypair();
  const queryId = `quick-start-${identity.publicKey.slice(0, 12)}`;

  const payload: QueryRequestPayload = {
    query_id: queryId,
    schema: ProofSchema.TlsnV1,
    customer_pubkey: identity.publicKey,
    oracle_pubkey: oracle.publicKey,
    max_amount_sats: 21,
    expires_at: Date.now() + 60_000,
  };
  const event = buildQueryRequestEvent(identity, payload);

  const echoedPromise = new Promise<QueryRequestPayload>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.close();
        reject(
          new QuickStartError(
            `relay did not echo the Request Notice within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      const subscription = relayClient.subscribe(
        { kinds: [KIND_QUERY_REQUEST], authors: [identity.publicKey] },
        (incoming) => {
          const parsed = parseQueryRequestEvent(incoming);
          if (parsed === null || parsed.query_id !== queryId) return;
          clearTimeout(timer);
          subscription.close();
          resolve(parsed);
        },
      );
    },
  );

  const publishResult = await relayClient.publish(event);
  if (publishResult.successes.length === 0) {
    throw new QuickStartError(
      `no relay accepted the Request Notice: ${
        publishResult.failures.map((f) => `${f.relay}: ${f.reason}`).join(", ")
      }`,
    );
  }

  const echoed = await echoedPromise;
  return {
    queryId,
    eventId: event.id,
    acceptedBy: publishResult.successes,
    echoed,
  };
}
