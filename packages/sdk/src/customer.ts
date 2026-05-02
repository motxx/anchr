/**
 * Customer — buyer-side of the Anchr verified-data exchange.
 *
 * The Customer broadcasts a request to Nostr relays, collects quotes
 * from providers that can fulfill it, locks a Cashu HTLC against the
 * chosen provider, waits for the proof + preimage, decrypts the
 * response, optionally verifies the proof locally, and returns the
 * verified data.
 *
 * Status (v0.0.1): the API surface, configuration validation, and the
 * first three wire-flow steps (oracle hash retrieval → ephemeral
 * identity → Cashu HTLC lock) are implemented. The remaining steps
 * (Nostr publish, quote subscription, selection, result decryption,
 * local verification) land in subsequent milestones.
 */

import type { CashuToken } from "./cashu.ts";
import type {
  CustomerOptions,
  Quote,
  RequestOptions,
  RequestResult,
} from "./types.ts";
import {
  isSchemaUri,
  InvalidSchemaUriError,
} from "./schema.ts";
import {
  createRelayClient,
  generateKeypair,
  type Keypair,
  type PublishResult,
  type RelayClient,
} from "./nostr.ts";
import { buildQueryRequestEvent, type QueryRequestPayload } from "./events.ts";

/**
 * Default quote-window in milliseconds. The SDK waits this long for
 * provider quotes before selecting one.
 */
export const DEFAULT_QUOTE_WINDOW_MS = 30_000;

/** Default locktime offset (1 hour) for HTLC-locked tokens. */
export const DEFAULT_LOCKTIME_SECONDS = 3600;

/** Default selector: cheapest quote within the customer's `payment.maxAmount`. */
export function selectCheapestQuote(quotes: Quote[]): Quote | null {
  if (quotes.length === 0) return null;
  return quotes.reduce((min, q) => (q.amountSats < min.amountSats ? q : min));
}

/** Customer client returned by `createCustomer`. */
export interface Customer {
  /** Send a request to the network and wait for a verified result. */
  request(options: RequestOptions): Promise<RequestResult>;
  /** Currently configured oracle whitelist (read-only copy). */
  readonly oracles: readonly string[];
  /** Currently configured Nostr relays. */
  readonly relays: readonly string[];
  /** Currently configured Cashu mint URL. */
  readonly mint: string;
}

/** Thrown when the customer configuration is rejected at construction time. */
export class CustomerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerConfigError";
  }
}

/** Thrown when the oracle returns a pubkey that doesn't match the customer's whitelist. */
export class OracleWhitelistMismatchError extends Error {
  constructor(public readonly expected: string, public readonly received: string) {
    super(`Oracle pubkey mismatch: expected ${expected}, got ${received}`);
    this.name = "OracleWhitelistMismatchError";
  }
}

/** Thrown when no relay accepted the published Job Request event. */
export class RelayPublishError extends Error {
  constructor(public readonly result: PublishResult) {
    super(
      `No relay accepted the Job Request event ` +
        `(${result.failures.length} failures, 0 successes).`,
    );
    this.name = "RelayPublishError";
  }
}

/**
 * Pick one oracle from the customer's whitelist for this request.
 *
 * v0 strategy: first oracle in the array. Future: health check, fee
 * comparison, or pluggable strategy via options.
 */
export function pickOracleForRequest(oracles: readonly string[]): string {
  if (oracles.length === 0) {
    throw new CustomerConfigError("oracles whitelist is empty");
  }
  return oracles[0];
}

/**
 * Validate a CustomerOptions instance. Throws CustomerConfigError on
 * any structural issue (empty oracles, no relays, missing mint, etc.).
 *
 * Accepts `unknown` and narrows to `CustomerOptions` on success so
 * runtime negative tests can pass arbitrary shapes without `as` casts.
 */
export function validateCustomerOptions(options: unknown): asserts options is CustomerOptions {
  if (typeof options !== "object" || options === null) {
    throw new CustomerConfigError("options must be an object");
  }
  const o = options as Record<string, unknown>;
  if (!Array.isArray(o.oracles) || o.oracles.length === 0) {
    throw new CustomerConfigError("oracles must be a non-empty string array");
  }
  for (const entry of o.oracles) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new CustomerConfigError("oracles entries must be non-empty strings");
    }
  }
  if (!Array.isArray(o.relays) || o.relays.length === 0) {
    throw new CustomerConfigError("relays must be a non-empty string array");
  }
  if (typeof o.mint !== "string" || o.mint.length === 0) {
    throw new CustomerConfigError("mint must be a non-empty string");
  }
  if (o.oracleClient === undefined || o.oracleClient === null) {
    throw new CustomerConfigError("oracleClient is required");
  }
  if (o.cashuClient === undefined || o.cashuClient === null) {
    throw new CustomerConfigError("cashuClient is required");
  }
}

/** Generate a unique query identifier for a single request. */
export function generateQueryId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `query_${ts}_${rand}`;
}

/**
 * Construct a Customer client.
 *
 * The constructor validates options eagerly — invalid config throws
 * synchronously, before any network I/O.
 */
export function createCustomer(options: CustomerOptions): Customer {
  validateCustomerOptions(options);
  const oracles = [...options.oracles];
  const relays = [...options.relays];
  const mint = options.mint;
  const oracleClient = options.oracleClient;
  const cashuClient = options.cashuClient;
  const quoteWindowMs = options.quoteWindowMs ?? DEFAULT_QUOTE_WINDOW_MS;
  const selector = options.quoteSelector ?? selectCheapestQuote;
  const verifiers = options.schemaVerifiers ?? {};

  return {
    oracles,
    relays,
    mint,

    async request(req: RequestOptions): Promise<RequestResult> {
      // [step 0] Validate the schema URI shape eagerly.
      if (!isSchemaUri(req.spec.schema)) {
        throw new InvalidSchemaUriError(req.spec.schema);
      }
      if (typeof req.payment.maxAmount !== "number" || req.payment.maxAmount <= 0) {
        throw new CustomerConfigError("payment.maxAmount must be a positive number");
      }
      if (!Array.isArray(req.sourceProofs)) {
        throw new CustomerConfigError("sourceProofs must be an array of Cashu proofs");
      }

      // [step 1] Pick an oracle from the whitelist.
      const expectedOracle = pickOracleForRequest(oracles);

      // [step 2] Generate ephemeral identity + query id for this request.
      const identity: Keypair = generateKeypair();
      const queryId = generateQueryId();

      // [step 3] Get hash from oracle. Verify the response carries the
      // pubkey we picked; reject if it differs (defense against a
      // mis-configured oracleClient pointing at a different oracle).
      const { hash, oraclePubkey } = await oracleClient.requestHash(queryId);
      if (oraclePubkey !== expectedOracle) {
        throw new OracleWhitelistMismatchError(expectedOracle, oraclePubkey);
      }

      // [step 4] Build the Phase-1 HTLC lock. The provider is unknown
      // at this point; the swap that binds the provider happens after
      // quote selection.
      const locktimeSeconds = Math.floor(Date.now() / 1000) +
        (req.payment.locktimeSeconds ?? DEFAULT_LOCKTIME_SECONDS);
      const initialLock: CashuToken = await cashuClient.buildHtlcLock({
        amountSats: req.payment.maxAmount,
        hashHex: hash,
        customerPubkey: identity.publicKey,
        locktimeSeconds,
        sourceProofs: req.sourceProofs,
      });

      // [step 5] Build + publish the kind 5300 Job Request event. Use
      // an injected RelayClient when available (tests inject a mock);
      // otherwise build one from the configured relays for this call.
      const ownsRelayClient = options.relayClient === undefined;
      const relayClient: RelayClient = options.relayClient ?? createRelayClient(relays);

      try {
        const requestPayload: QueryRequestPayload = {
          query_id: queryId,
          schema: req.spec.schema,
          predicate: req.spec.predicate,
          description: req.spec.description,
          customer_pubkey: identity.publicKey,
          oracle_pubkey: oraclePubkey,
          mint_url: mint,
          bounty_token: initialLock.token,
          max_amount_sats: req.payment.maxAmount,
          locktime_seconds: locktimeSeconds,
          expires_at: Date.now() + quoteWindowMs,
        };
        const requestEvent = buildQueryRequestEvent(identity, requestPayload);
        const publishResult = await relayClient.publish(requestEvent);

        if (publishResult.successes.length === 0) {
          throw new RelayPublishError(publishResult);
        }

        // Captured for the next-milestone wire-flow steps; explicitly
        // referenced so static analysis treats them as used.
        void selector;
        void verifiers;
        void req.provider;

        // TODO(P2 chunk 5-7): implement remaining wire flow:
        //   6. Subscribe to kind 7000 quotes for quoteWindowMs
        //   7. Select via selector(quotes), bind HTLC to provider pubkey
        //   8. Subscribe to kind 6300 result event
        //   9. Decrypt response payload via NIP-44
        //  10. Optionally call verifiers[req.spec.schema] for local verification
        //  11. Return RequestResult
        throw new Error(
          "Customer.request: wire flow steps 6-11 not implemented in v0.0.1. " +
            `Job Request event ${requestEvent.id.slice(0, 16)}… ` +
            `accepted by ${publishResult.successes.length} of ` +
            `${publishResult.successes.length + publishResult.failures.length} relays.`,
        );
      } finally {
        if (ownsRelayClient) {
          relayClient.close();
        }
      }
    },
  };
}
