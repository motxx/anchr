/**
 * Customer — buyer-side of the Anchr verified-data exchange.
 *
 * The Customer broadcasts a request to Nostr relays, collects quotes
 * from providers that can fulfill it, locks a Cashu HTLC against the
 * chosen provider, waits for the proof + preimage, decrypts the
 * response, optionally verifies the proof locally, and returns the
 * verified data.
 *
 * Status: the API surface and configuration validation are stable in
 * v0.0.1. The actual Nostr / Cashu wire flow inside `request()` is
 * implemented incrementally — see TODO markers.
 */

import type {
  CustomerOptions,
  RequestOptions,
  RequestResult,
  Quote,
} from "./types.ts";
import {
  isSchemaUri,
  InvalidSchemaUriError,
} from "./schema.ts";

/**
 * Default quote-window in milliseconds. The SDK waits this long for
 * provider quotes before selecting one.
 */
export const DEFAULT_QUOTE_WINDOW_MS = 30_000;

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
 */
export function validateCustomerOptions(options: CustomerOptions): void {
  if (!Array.isArray(options.oracles) || options.oracles.length === 0) {
    throw new CustomerConfigError("oracles must be a non-empty string array");
  }
  for (const o of options.oracles) {
    if (typeof o !== "string" || o.length === 0) {
      throw new CustomerConfigError("oracles entries must be non-empty strings");
    }
  }
  if (!Array.isArray(options.relays) || options.relays.length === 0) {
    throw new CustomerConfigError("relays must be a non-empty string array");
  }
  if (typeof options.mint !== "string" || options.mint.length === 0) {
    throw new CustomerConfigError("mint must be a non-empty string");
  }
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
  const quoteWindowMs = options.quoteWindowMs ?? DEFAULT_QUOTE_WINDOW_MS;
  const selector = options.quoteSelector ?? selectCheapestQuote;
  const verifiers = options.schemaVerifiers ?? {};

  return {
    oracles,
    relays,
    mint,

    async request(req: RequestOptions): Promise<RequestResult> {
      // Validate the schema URI shape eagerly.
      if (!isSchemaUri(req.spec.schema)) {
        throw new InvalidSchemaUriError(req.spec.schema);
      }
      if (typeof req.payment.maxAmount !== "number" || req.payment.maxAmount <= 0) {
        throw new CustomerConfigError("payment.maxAmount must be a positive number");
      }

      // Pick an oracle from the whitelist for this query (v0: first).
      const _oraclePubkey = pickOracleForRequest(oracles);

      // Reference: quoteWindowMs and selector are used by the wire flow
      // implemented in the next milestone (P2). They're captured here so
      // that consumers can already construct + introspect Customer objects.
      void quoteWindowMs;
      void selector;
      void verifiers;
      void req.provider;

      // TODO(P2): implement the wire flow:
      //   1. Request hash H from oracle (HTTP or Nostr DM)
      //   2. Lock Cashu HTLC at mint with hashlock H
      //   3. Publish kind 5300 Job Request to relays
      //   4. Subscribe to kind 7000 quotes for quoteWindowMs
      //   5. Select via selector(quotes), bind HTLC to provider pubkey
      //   6. Subscribe to kind 6300 result event
      //   7. Decrypt response payload via NIP-44
      //   8. Optionally call verifiers[req.spec.schema] for local verification
      //   9. Return RequestResult
      throw new Error(
        "Customer.request: wire flow not implemented in v0.0.1. " +
          "Tracked as P2 in the SDK rewrite plan.",
      );
    },
  };
}
