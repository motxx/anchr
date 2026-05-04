/**
 * Customer — buyer-side of the Anchr verified-data exchange.
 *
 * The Customer broadcasts a request to Nostr relays, collects quotes
 * from providers that can fulfill it, locks a Cashu HTLC against the
 * chosen provider, waits for the proof + preimage, decrypts the
 * response, optionally verifies the proof locally, and returns the
 * verified data.
 *
 * Wire flow (each step is implemented in `request()` below):
 *   0. Validate the request shape.
 *   1. Pick an oracle from the configured whitelist.
 *   2. Generate an ephemeral keypair + query id.
 *   3. Ask the oracle for a hash `H` (preimage held by oracle).
 *   4. Build the Phase-1 HTLC lock from the customer's source proofs.
 *   5. Publish a kind 5300 Job Request event.
 *   6. Subscribe to kind 7000 quotes for `quoteWindowMs`.
 *   7. Select a quote, Phase-2-bind the HTLC to the chosen provider,
 *      and announce the selection via kind 7000 status=processing.
 *   8. Subscribe to the kind 6300 result from the selected provider.
 *   9. NIP-44-decrypt the response.
 *  10. Optionally invoke a schema-specific verifier.
 *  11. Return the verified data + proof.
 */

import { createCashuClient, type CashuToken } from "./cashu.ts";
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
  type Event as NostrEvent,
  type Keypair,
  type PublishResult,
  type RelayClient,
} from "./nostr.ts";
import {
  buildQueryRequestEvent,
  buildSelectionFeedbackEvent,
  parseQueryResponseEvent,
  parseQuoteFeedbackEvent,
  type QueryRequestPayload,
  type SelectionFeedbackPayload,
} from "./events.ts";

/**
 * Default quote-window in milliseconds. The SDK waits this long for
 * provider quotes before selecting one.
 */
export const DEFAULT_QUOTE_WINDOW_MS = 30_000;

/** Default locktime offset (1 hour) for HTLC-locked tokens. */
export const DEFAULT_LOCKTIME_SECONDS = 3600;

/** Default result-event timeout (5 minutes). */
export const DEFAULT_RESULT_TIMEOUT_MS = 5 * 60_000;

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

/** Thrown when no provider sent a (selectable) quote within the configured window. */
export class NoQuotesReceivedError extends Error {
  constructor(public readonly quoteWindowMs: number, public readonly receivedCount: number) {
    super(
      `No selectable quote received within ${quoteWindowMs}ms ` +
        `(received ${receivedCount} candidate quote(s) total).`,
    );
    this.name = "NoQuotesReceivedError";
  }
}

/** Thrown when the selected provider did not deliver a result before the timeout elapsed. */
export class ResultTimeoutError extends Error {
  constructor(public readonly timeoutMs: number, public readonly providerPubkey: string) {
    super(
      `Provider ${providerPubkey.slice(0, 16)}… did not deliver a kind 6300 result ` +
        `within ${timeoutMs}ms.`,
    );
    this.name = "ResultTimeoutError";
  }
}

/** Thrown when a registered SchemaVerifier rejects the proof + data the provider returned. */
export class SchemaVerificationError extends Error {
  constructor(public readonly schema: string) {
    super(`Local schema verifier rejected the proof for schema ${schema}.`);
    this.name = "SchemaVerificationError";
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
  const cashuClient = options.cashuClient ?? createCashuClient({ mintUrl: mint });
  const quoteWindowMs = options.quoteWindowMs ?? DEFAULT_QUOTE_WINDOW_MS;
  const resultTimeoutMs = options.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS;
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

        // [step 6] Subscribe to kind 7000 quotes referencing our request
        // event for `quoteWindowMs`. Collect candidate quotes (filtered
        // by amount ≤ maxAmount and structurally valid) into a buffer.
        const quotes: Quote[] = [];
        let totalReceived = 0;
        const sub = relayClient.subscribe(
          {
            kinds: [7000],
            "#e": [requestEvent.id],
          },
          (event) => {
            const parsed = parseQuoteFeedbackEvent(event);
            if (parsed === null) return;
            totalReceived++;
            if (parsed.amount_sats > req.payment.maxAmount) return;
            if (req.provider !== undefined && parsed.provider_pubkey !== req.provider) return;
            quotes.push({
              providerPubkey: parsed.provider_pubkey,
              amountSats: parsed.amount_sats,
              quoteEventId: event.id,
              receivedAt: Date.now(),
            });
          },
        );

        try {
          await new Promise<void>((resolve) => setTimeout(resolve, quoteWindowMs));
        } finally {
          sub.close();
        }

        // [step 7] Apply the selector strategy.
        const selected = selector(quotes);
        if (selected === null) {
          throw new NoQuotesReceivedError(quoteWindowMs, totalReceived);
        }

        // [step 7 cont] Phase-2 swap: bind the chosen provider's pubkey
        // to the existing HTLC. The Phase-1 proofs are P2PK-locked to
        // `identity.publicKey`, so the swap requires `identity.secretKey`
        // to satisfy the input lock. We pass the proofs directly rather
        // than re-decoding the broadcast token — the encoded V4 form
        // truncates keyset IDs and would require wallet keychain access
        // to map them back.
        const boundLock: CashuToken = await cashuClient.bindProvider({
          initialProofs: initialLock.proofs,
          providerPubkey: selected.providerPubkey,
          hashHex: hash,
          locktimeSeconds,
          customerPubkey: identity.publicKey,
          customerSecretKey: identity.secretKey,
        });

        // [step 7 cont] Announce the selection so the chosen provider
        // can begin work.
        const selectionPayload: SelectionFeedbackPayload = {
          status: "processing",
          selected_provider_pubkey: selected.providerPubkey,
          bound_token: boundLock.token,
        };
        const selectionEvent = buildSelectionFeedbackEvent(
          identity,
          requestEvent.id,
          selectionPayload,
        );
        await relayClient.publish(selectionEvent);

        // [step 8] Subscribe to the kind 6300 result event from the
        // selected provider, referencing our request event id.
        const resultEvent = await new Promise<NostrEvent>((resolve, reject) => {
          // Mutable holder so the subscribe callback can reach the
          // eventually-set timeout id (and vice versa).
          const handles: {
            sub?: { close(): void };
            timeoutId?: ReturnType<typeof setTimeout>;
          } = {};
          handles.sub = relayClient.subscribe(
            {
              kinds: [6300],
              "#e": [requestEvent.id],
              authors: [selected.providerPubkey],
            },
            (event) => {
              handles.sub?.close();
              if (handles.timeoutId !== undefined) clearTimeout(handles.timeoutId);
              resolve(event);
            },
          );
          handles.timeoutId = setTimeout(() => {
            handles.sub?.close();
            reject(new ResultTimeoutError(resultTimeoutMs, selected.providerPubkey));
          }, resultTimeoutMs);
        });

        // [step 9] Decrypt the NIP-44-encrypted response with our
        // ephemeral secret + provider pubkey.
        const response = parseQueryResponseEvent(
          resultEvent,
          identity.secretKey,
          selected.providerPubkey,
        );
        if (response === null) {
          throw new ResultTimeoutError(resultTimeoutMs, selected.providerPubkey);
        }

        // [step 10] Optional schema-specific local verification.
        const verifier = verifiers[req.spec.schema];
        if (verifier !== undefined) {
          const ok = await Promise.resolve(
            verifier(response.proof, req.spec.predicate, response.data),
          );
          if (!ok) {
            throw new SchemaVerificationError(req.spec.schema);
          }
        }

        // [step 11] Return the verified result.
        return {
          data: response.data,
          proof: response.proof,
          providerPubkey: selected.providerPubkey,
          schema: response.schema,
        };
      } finally {
        if (ownsRelayClient) {
          relayClient.close();
        }
      }
    },
  };
}
