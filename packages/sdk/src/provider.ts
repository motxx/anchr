/**
 * Provider — fulfillment-side of the Anchr verified-data exchange.
 *
 * The Provider subscribes to Nostr relays for kind 5300 Job Requests
 * addressed to oracles in its whitelist, sends kind 7000 quotes for
 * requests it can fulfill, waits for selection by the customer, runs
 * the schema-specific producer to generate the proof, encrypts the
 * response to the customer's pubkey via NIP-44, publishes a kind 6300
 * result event, waits for the oracle's preimage delivery via NIP-44 DM,
 * and redeems the Cashu HTLC.
 *
 * Status: the API surface and configuration validation are stable in
 * v0.0.1. The actual Nostr / Cashu wire flow inside `serve()` is
 * implemented incrementally — see TODO markers.
 */

import type {
  ProviderHandler,
  ProviderOptions,
} from "./types.ts";

/** Provider client returned by `createProvider`. */
export interface Provider {
  /**
   * Start serving requests. The handler is called for each incoming
   * request that this provider can quote. Resolves when `stop()` is
   * called or the underlying subscription closes.
   */
  serve(handler: ProviderHandler): Promise<void>;
  /** Stop the running subscription, if any. */
  stop(): Promise<void>;
  /** Currently configured oracle whitelist (read-only copy). */
  readonly oracles: readonly string[];
  /** Currently configured Nostr relays. */
  readonly relays: readonly string[];
  /** Currently configured Cashu mint URL. */
  readonly mint: string;
  /** Currently configured TLSN notary URL, if any. */
  readonly notary?: string;
}

/** Thrown when the provider configuration is rejected at construction time. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/**
 * Validate a ProviderOptions instance. Throws ProviderConfigError on
 * any structural issue.
 */
export function validateProviderOptions(options: ProviderOptions): void {
  if (!Array.isArray(options.oracles) || options.oracles.length === 0) {
    throw new ProviderConfigError("oracles must be a non-empty string array");
  }
  for (const o of options.oracles) {
    if (typeof o !== "string" || o.length === 0) {
      throw new ProviderConfigError("oracles entries must be non-empty strings");
    }
  }
  if (!Array.isArray(options.relays) || options.relays.length === 0) {
    throw new ProviderConfigError("relays must be a non-empty string array");
  }
  if (typeof options.mint !== "string" || options.mint.length === 0) {
    throw new ProviderConfigError("mint must be a non-empty string");
  }
  if (typeof options.privKey !== "string" || options.privKey.length === 0) {
    throw new ProviderConfigError("privKey must be a non-empty string");
  }
  if (options.notary !== undefined) {
    if (typeof options.notary !== "string" || options.notary.length === 0) {
      throw new ProviderConfigError("notary, when provided, must be a non-empty string");
    }
  }
}

/**
 * Returns true when the request's oracle pubkey is in this provider's
 * whitelist. Used as the gate before quoting.
 */
export function shouldQuote(
  providerOracles: readonly string[],
  requestOraclePubkey: string,
): boolean {
  return providerOracles.includes(requestOraclePubkey);
}

/**
 * Construct a Provider client.
 *
 * The constructor validates options eagerly — invalid config throws
 * synchronously, before any network I/O.
 */
export function createProvider(options: ProviderOptions): Provider {
  validateProviderOptions(options);
  const oracles = [...options.oracles];
  const relays = [...options.relays];
  const mint = options.mint;
  const notary = options.notary;
  const privKey = options.privKey;
  const producers = options.schemaProducers ?? {};

  let stopped = false;

  return {
    oracles,
    relays,
    mint,
    notary,

    async serve(_handler: ProviderHandler): Promise<void> {
      // Reference: privKey, producers, notary are used by the wire flow
      // implemented in the next milestone (P2). They're captured here so
      // that consumers can already construct + introspect Provider objects.
      void privKey;
      void producers;
      void notary;
      void _handler;

      // TODO(P2): implement the wire flow:
      //   1. Subscribe to kind 5300 events on relays
      //   2. For each event, parse, check oracle pubkey in whitelist (shouldQuote)
      //   3. Resolve the schema producer registered for the request's schema URI
      //   4. Send kind 7000 status=payment-required quote
      //   5. Wait for kind 7000 status=processing selection event addressed to us
      //   6. Verify HTLC at mint binds to our pubkey
      //   7. Run handler() OR producers[schema](predicate, ctx) to produce proof
      //   8. Encrypt response (data + proof) to customer pubkey via NIP-44
      //   9. Publish kind 6300 result event
      //  10. Subscribe to NIP-44 DM (kind 4) from oracle for preimage S
      //  11. Redeem Cashu HTLC at mint using preimage + provider sig
      throw new Error(
        "Provider.serve: wire flow not implemented in v0.0.1. " +
          "Tracked as P2 in the SDK rewrite plan.",
      );
    },

    async stop(): Promise<void> {
      stopped = true;
      void stopped;
      // TODO(P2): close any open subscriptions
    },
  };
}
