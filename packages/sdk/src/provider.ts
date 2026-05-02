/**
 * Provider — fulfillment-side of the Anchr verified-data exchange.
 *
 * The Provider subscribes to Nostr relays for kind 5300 Job Requests
 * addressed to oracles in its whitelist, calls a handler to decide
 * whether (and at what price) to quote, sends a kind 7000 quote, and
 * — once selected — runs the lazy producer the handler returned to
 * generate a proof, NIP-44-encrypts the response to the customer, and
 * publishes a kind 6300 result event.
 *
 * Status (v0.0.1): subscribe + parse + whitelist filter + handler
 * invocation + quote publish are implemented. Selection wait, result
 * publish, preimage wait, and HTLC redemption land in the next
 * milestones.
 */

import {
  buildQuoteFeedbackEvent,
  parseQueryRequestEvent,
} from "./events.ts";
import {
  createRelayClient,
  type Event as NostrEvent,
  type Keypair,
  normalizeSecretKey,
  type RelayClient,
  signEvent as _signEvent,
} from "./nostr.ts";
import { getPublicKey } from "nostr-tools/pure";
import type {
  ProviderHandler,
  ProviderOptions,
  ProviderQuote,
  ProviderRequestEvent,
} from "./types.ts";
import { isSchemaUri } from "./schema.ts";

/** Default timeout for waiting for the customer's selection event after a quote (60s). */
export const DEFAULT_SELECTION_TIMEOUT_MS = 60_000;

/** Provider client returned by `createProvider`. */
export interface Provider {
  /**
   * Start serving requests. The handler is called for each incoming
   * kind 5300 event whose oracle pubkey is in this provider's whitelist.
   * Resolves when `stop()` is called.
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
  /** Provider's hex pubkey (derived from the configured secret key). */
  readonly pubkey: string;
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
 * any structural issue. Accepts `unknown` and narrows on success so
 * negative tests can pass arbitrary shapes without `as` casts.
 */
export function validateProviderOptions(options: unknown): asserts options is ProviderOptions {
  if (typeof options !== "object" || options === null) {
    throw new ProviderConfigError("options must be an object");
  }
  const o = options as Record<string, unknown>;
  if (!Array.isArray(o.oracles) || o.oracles.length === 0) {
    throw new ProviderConfigError("oracles must be a non-empty string array");
  }
  for (const entry of o.oracles) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ProviderConfigError("oracles entries must be non-empty strings");
    }
  }
  if (!Array.isArray(o.relays) || o.relays.length === 0) {
    throw new ProviderConfigError("relays must be a non-empty string array");
  }
  if (typeof o.mint !== "string" || o.mint.length === 0) {
    throw new ProviderConfigError("mint must be a non-empty string");
  }
  if (typeof o.privKey !== "string" || o.privKey.length === 0) {
    throw new ProviderConfigError("privKey must be a non-empty string");
  }
  if (o.cashuClient === undefined || o.cashuClient === null) {
    throw new ProviderConfigError("cashuClient is required");
  }
  if (o.notary !== undefined) {
    if (typeof o.notary !== "string" || o.notary.length === 0) {
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
  const cashuClient = options.cashuClient;
  const selectionTimeoutMs = options.selectionTimeoutMs ?? DEFAULT_SELECTION_TIMEOUT_MS;

  // Resolve the provider's keypair eagerly so failures surface at
  // construction rather than on the first event.
  const secretKey = normalizeSecretKey(options.privKey);
  const pubkey = getPublicKey(secretKey);
  const identity: Keypair = { secretKey, publicKey: pubkey };

  // Live-loop state captured by serve() / stop().
  const state: { stop?: () => void } = {};

  return {
    oracles,
    relays,
    mint,
    notary,
    pubkey,

    async serve(handler: ProviderHandler): Promise<void> {
      const ownsRelayClient = options.relayClient === undefined;
      const relayClient: RelayClient = options.relayClient ?? createRelayClient(relays);

      return new Promise<void>((resolveServe) => {
        const sub = relayClient.subscribe(
          { kinds: [5300] },
          (event) => {
            // Each job runs concurrently so a long-running handler
            // does not block the subscription loop.
            handleJob(event, {
              identity,
              oracles,
              cashuClient,
              relayClient,
              selectionTimeoutMs,
            }, handler).catch(() => {
              // Swallow per-job failures; one bad event should not
              // tear down the provider's subscription. Consumers can
              // log inside their handler.
            });
          },
        );

        state.stop = () => {
          sub.close();
          if (ownsRelayClient) relayClient.close();
          state.stop = undefined;
          resolveServe();
        };
      });
    },

    async stop(): Promise<void> {
      if (state.stop !== undefined) state.stop();
    },
  };
}

/** Internal context shared with handleJob. */
interface JobContext {
  identity: Keypair;
  oracles: readonly string[];
  cashuClient: import("./cashu.ts").CashuClient;
  relayClient: RelayClient;
  selectionTimeoutMs: number;
}

/**
 * Per-event job handler — runs steps 1-4 of the wire flow:
 *   1. Parse request payload
 *   2. Filter by oracle whitelist
 *   3. Validate schema URI shape
 *   4. Call handler for a quote, publish kind 7000 if accepted
 *
 * Steps 5-10 (selection wait, produce, encrypt+publish, preimage,
 * redeem) are tracked as the next provider milestones.
 */
async function handleJob(
  event: NostrEvent,
  ctx: JobContext,
  handler: ProviderHandler,
): Promise<void> {
  const payload = parseQueryRequestEvent(event);
  if (payload === null) return;
  if (!shouldQuote(ctx.oracles, payload.oracle_pubkey)) return;
  if (!isSchemaUri(payload.schema)) return;

  const request: ProviderRequestEvent = {
    customerPubkey: payload.customer_pubkey,
    spec: {
      schema: payload.schema,
      predicate: payload.predicate,
      description: payload.description,
    },
    maxAmountSats: payload.max_amount_sats,
    oraclePubkey: payload.oracle_pubkey,
  };

  let quote: ProviderQuote | null;
  try {
    quote = await handler(request);
  } catch {
    return; // handler errored — decline silently
  }
  if (quote === null) return;
  if (typeof quote.amountSats !== "number" || quote.amountSats <= 0) return;
  if (quote.amountSats > payload.max_amount_sats) return;

  const quoteEvent = buildQuoteFeedbackEvent(
    ctx.identity,
    event.id,
    payload.customer_pubkey,
    {
      status: "payment-required",
      provider_pubkey: ctx.identity.publicKey,
      amount_sats: quote.amountSats,
    },
  );
  await ctx.relayClient.publish(quoteEvent);

  // TODO(P2 chunk 8): wait for selection event, run quote.produce(),
  // encrypt+publish kind 6300, wait for oracle preimage DM, redeem HTLC.
  void quote.produce; // captured for next chunk
  void ctx.selectionTimeoutMs;
  void ctx.cashuClient;
}
