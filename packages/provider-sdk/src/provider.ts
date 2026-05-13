/**
 * Provider — fulfillment-side of the Anchr verified-data exchange.
 *
 * Subscribes to NIP-90 kind 5300 job requests, quotes via kind 7000,
 * produces proofs after selection, publishes kind 6300 results, and
 * redeems the HTLC once the oracle releases the preimage.
 */

import {
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
  parsePreimageDeliveryEvent,
  parseQueryRequestEvent,
  parseSelectionFeedbackEvent,
} from "@anchr/protocol/events";
import { createRelayClient, type RelayClient } from "./nostr.ts";
import {
  type Event as NostrEvent,
  findTagValue,
  type Keypair,
  normalizeSecretKey,
} from "@anchr/protocol/nostr";
import { getPublicKey } from "nostr-tools/pure";
import type {
  ProofGenerator,
  ProviderHandler,
  ProviderOptions,
  ProviderQuote,
  ProviderRequestEvent,
} from "./types.ts";
import { isSchemaUri, resolveProofGenerator } from "@anchr/protocol/schema";
import { type CashuClient, createCashuClient } from "./cashu.ts";

/** Default timeout for waiting for the customer's selection event after a quote (60s). */
export const DEFAULT_SELECTION_TIMEOUT_MS = 60_000;

/** Default timeout for waiting for the oracle's preimage NIP-44 DM after publishing the result (5 min). */
export const DEFAULT_PREIMAGE_TIMEOUT_MS = 5 * 60_000;

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
export function validateProviderOptions(
  options: unknown,
): asserts options is ProviderOptions {
  if (typeof options !== "object" || options === null) {
    throw new ProviderConfigError("options must be an object");
  }
  const o = options as Record<string, unknown>;
  if (!Array.isArray(o.oracles) || o.oracles.length === 0) {
    throw new ProviderConfigError("oracles must be a non-empty string array");
  }
  for (const entry of o.oracles) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ProviderConfigError(
        "oracles entries must be non-empty strings",
      );
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
  if (o.notary !== undefined) {
    if (typeof o.notary !== "string" || o.notary.length === 0) {
      throw new ProviderConfigError(
        "notary, when provided, must be a non-empty string",
      );
    }
  }
  if (o.proofGenerators !== undefined) {
    if (!Array.isArray(o.proofGenerators)) {
      throw new ProviderConfigError(
        "proofGenerators, when provided, must be an array",
      );
    }
    for (const entry of o.proofGenerators) {
      if (typeof entry !== "object" || entry === null) {
        throw new ProviderConfigError(
          "proofGenerators entries must be objects",
        );
      }
      const canHandle = "canHandle" in entry ? entry.canHandle : undefined;
      const produce = "produce" in entry ? entry.produce : undefined;
      if (
        typeof canHandle !== "function" ||
        typeof produce !== "function"
      ) {
        throw new ProviderConfigError(
          "proofGenerators entries must expose canHandle and produce",
        );
      }
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
  const cashuClient = options.cashuClient ??
    createCashuClient({ mintUrl: mint });
  const selectionTimeoutMs = options.selectionTimeoutMs ??
    DEFAULT_SELECTION_TIMEOUT_MS;
  const preimageTimeoutMs = options.preimageTimeoutMs ??
    DEFAULT_PREIMAGE_TIMEOUT_MS;
  const proofGenerators = options.proofGenerators ?? [];

  const secretKey = normalizeSecretKey(options.privKey);
  const pubkey = getPublicKey(secretKey);
  const identity: Keypair = { secretKey, publicKey: pubkey };

  const state: { stop?: () => void } = {};

  return {
    oracles,
    relays,
    mint,
    notary,
    pubkey,

    async serve(handler: ProviderHandler): Promise<void> {
      const ownsRelayClient = options.relayClient === undefined;
      const relayClient: RelayClient = options.relayClient ??
        createRelayClient(relays);

      return new Promise<void>((resolveServe) => {
        const sub = relayClient.subscribe(
          { kinds: [5300] },
          (event) => {
            // Run each job concurrently so a slow handler does not
            // block the subscription loop.
            handleJob(event, {
              identity,
              oracles,
              cashuClient,
              relayClient,
              selectionTimeoutMs,
              preimageTimeoutMs,
              proofGenerators,
            }, handler).catch(() => {
              // One bad event must not tear down the subscription.
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

interface JobContext {
  identity: Keypair;
  oracles: readonly string[];
  cashuClient: CashuClient;
  relayClient: RelayClient;
  selectionTimeoutMs: number;
  preimageTimeoutMs: number;
  proofGenerators: readonly ProofGenerator[];
}

async function handleJob(
  event: NostrEvent,
  ctx: JobContext,
  handler: ProviderHandler,
): Promise<void> {
  const payload = parseQueryRequestEvent(event);
  if (payload === null) return;
  if (!shouldQuote(ctx.oracles, payload.oracle_pubkey)) return;
  if (!isSchemaUri(payload.schema)) return;
  const proofGenerator = ctx.proofGenerators.length === 0
    ? null
    : resolveProofGenerator(ctx.proofGenerators, payload.schema);
  if (ctx.proofGenerators.length > 0 && proofGenerator === null) return;

  const request: ProviderRequestEvent = {
    customerPubkey: payload.customer_pubkey,
    spec: {
      schema: payload.schema,
      predicate: payload.predicate,
      description: payload.description,
    },
    maxAmountSats: payload.max_amount_sats,
    oraclePubkey: payload.oracle_pubkey,
    proofGenerator: proofGenerator ?? undefined,
  };

  let quote: ProviderQuote | null;
  try {
    quote = await handler(request);
  } catch {
    return;
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

  const selection = await waitForSelection(
    ctx,
    event.id,
    payload.customer_pubkey,
  );
  if (selection === null) return;

  let result: { data: unknown; proof: Uint8Array | string };
  try {
    result = await quote.produce();
  } catch {
    return;
  }

  const responseEvent = buildQueryResponseEvent(
    ctx.identity,
    event.id,
    payload.customer_pubkey,
    {
      schema: payload.schema,
      data: result.data,
      proof: result.proof,
    },
    payload.oracle_pubkey,
    payload.query_id,
  );
  await ctx.relayClient.publish(responseEvent);

  const preimage = await waitForPreimage(
    ctx,
    payload.oracle_pubkey,
    payload.query_id,
    event.id,
  );
  if (preimage === null) return;

  try {
    await ctx.cashuClient.redeemHtlc({
      token: selection.bound_token,
      preimageHex: preimage,
      providerSecretKey: ctx.identity.secretKey,
    });
  } catch {
    return;
  }
}

/**
 * Wait for the oracle's preimage NIP-44 DM addressed to us. Returns
 * the hex preimage on success, or null on timeout / parse failure.
 */
function waitForPreimage(
  ctx: JobContext,
  oraclePubkey: string,
  queryId: string,
  requestEventId: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const handles: {
      sub?: { close(): void };
      timeoutId?: ReturnType<typeof setTimeout>;
    } = {};
    handles.sub = ctx.relayClient.subscribe(
      {
        kinds: [4],
        authors: [oraclePubkey],
        "#p": [ctx.identity.publicKey],
      },
      (event) => {
        const parsed = parsePreimageDeliveryEvent(
          event,
          ctx.identity.secretKey,
          oraclePubkey,
        );
        if (parsed === null) return;
        // Cross-check both ids so a stale DM for another request can't be replayed.
        if (parsed.query_id !== queryId) return;
        if (parsed.request_event_id !== requestEventId) return;
        handles.sub?.close();
        if (handles.timeoutId !== undefined) clearTimeout(handles.timeoutId);
        resolve(parsed.preimage);
      },
    );
    handles.timeoutId = setTimeout(() => {
      handles.sub?.close();
      resolve(null);
    }, ctx.preimageTimeoutMs);
  });
}

/**
 * Wait for the customer's kind 7000 status=processing selection event
 * referencing our quote. Returns the parsed selection payload, or
 * null on timeout / no addressed-to-us event.
 */
function waitForSelection(
  ctx: JobContext,
  requestEventId: string,
  customerPubkey: string,
): Promise<{ bound_token: string } | null> {
  return new Promise((resolve) => {
    const handles: {
      sub?: { close(): void };
      timeoutId?: ReturnType<typeof setTimeout>;
    } = {};
    handles.sub = ctx.relayClient.subscribe(
      {
        kinds: [7000],
        "#e": [requestEventId],
        authors: [customerPubkey],
      },
      (event) => {
        const selectedPubkey = findTagValue(event, "p");
        if (selectedPubkey !== ctx.identity.publicKey) return;
        const parsed = parseSelectionFeedbackEvent(event);
        if (parsed === null) return;
        handles.sub?.close();
        if (handles.timeoutId !== undefined) clearTimeout(handles.timeoutId);
        resolve({ bound_token: parsed.bound_token });
      },
    );
    handles.timeoutId = setTimeout(() => {
      handles.sub?.close();
      resolve(null);
    }, ctx.selectionTimeoutMs);
  });
}
