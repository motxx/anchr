/**
 * Oracle client — abstracts how the SDK talks to an oracle.
 *
 * The oracle plays two roles in the protocol:
 *   1. Pre-flight: returns a hash `H` whose preimage `S` it holds and
 *      will release if (and only if) it verifies a valid proof later.
 *      The customer locks Cashu HTLC against `H`.
 *   2. Settlement: after receiving the provider's proof and verifying
 *      it, sends the preimage `S` to the provider via NIP-44 DM.
 *
 * The v0 exchange uses relay-delivered Nostr DMs for hash bootstrap.
 * Host operators can pass a custom OracleClient implementation when their
 * application owns a different deployment-specific policy.
 */

import {
  buildHashRequestEvent,
  parseHashResponseEvent,
} from "@anchr/protocol/events";
import { KIND_DIRECT_MESSAGE } from "@anchr/protocol/nostr";
import { generateEphemeralIdentity } from "./identity.ts";
import type { RelayClient } from "./adapters/types.ts";
import { waitForFirstEvent } from "./relay-wait.ts";

export interface OracleClient {
  /**
   * Request a fresh hash for a query. The oracle commits to releasing
   * the preimage that hashes to the returned value once it has verified
   * a valid proof for the same query id.
   *
   * @param queryId — caller-chosen unique id for this query
   * @returns the hash (hex)
   */
  requestHash(queryId: string): Promise<{ hash: string }>;
}

/** Thrown when the oracle client is configured with invalid options. */
export class OracleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleConfigError";
  }
}

/** Thrown when the oracle response payload doesn't contain `hash`. */
export class OracleResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleResponseError";
  }
}

/** Thrown when the oracle does not answer a hash bootstrap DM in time. */
export class OracleTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Oracle hash bootstrap timed out after ${timeoutMs}ms`);
    this.name = "OracleTimeoutError";
  }
}

/** Construction options for {@link createNostrOracleClient}. */
export interface NostrOracleOptions {
  /** Relay transport used for the bootstrap DMs. */
  relayClient: RelayClient;
  /** The Oracle's Nostr pubkey (hex). */
  oraclePubkey: string;
  /** How long to wait for the response DM. Default 10s. */
  timeoutMs?: number;
}

/**
 * Default OracleClient: the hash bootstrap rides the relay as NIP-44 DMs.
 * Each request uses a fresh ephemeral sender keypair, so the bootstrap is
 * unlinkable from the later advertisement and neither side needs an HTTP
 * endpoint (INV-08).
 */
export function createNostrOracleClient(
  options: NostrOracleOptions,
): OracleClient {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (options.oraclePubkey.length === 0) {
    throw new OracleConfigError("oraclePubkey must be a non-empty string");
  }

  return {
    async requestHash(queryId: string): Promise<{ hash: string }> {
      const identity = generateEphemeralIdentity();
      const wait = waitForFirstEvent(
        options.relayClient,
        {
          kinds: [KIND_DIRECT_MESSAGE],
          authors: [options.oraclePubkey],
          "#p": [identity.publicKey],
        },
        (event) => {
          const payload = parseHashResponseEvent(
            event,
            identity.secretKey,
            options.oraclePubkey,
          );
          if (payload === null || payload.query_id !== queryId) return null;
          return payload.hash;
        },
        timeoutMs,
      );
      const request = buildHashRequestEvent(identity, options.oraclePubkey, {
        type: "hash_request",
        query_id: queryId,
      });
      const published = await options.relayClient.publish(request);
      if (published.successes.length === 0) {
        wait.cancel();
        throw new OracleResponseError(
          `no relay accepted the hash bootstrap DM: ${
            published.failures.map((f) => f.reason).join(", ")
          }`,
        );
      }
      const hash = await wait.result;
      if (hash === null) throw new OracleTimeoutError(timeoutMs);
      return { hash };
    },
  };
}
