/**
 * Customer — buyer-side of the Anchr verified-data exchange.
 *
 * Broadcasts a request to Nostr, collects provider offers, locks a
 * Cashu HTLC against the chosen provider, decrypts the response, and
 * returns the verified data + proof.
 */

import type {
  ActorStateStore,
  CashuToken,
  PublishResult,
  RelayClient,
} from "./adapters/types.ts";
import type {
  CustomerOptions,
  CustomerOracle,
  Offer,
  RequestOptions,
  RequestResult,
} from "./customer-types.ts";
import {
  InvalidSchemaUriError,
  isSchemaUri,
  resolveVerifierAdapter,
} from "./schema.ts";
import { type Event as NostrEvent, type Keypair } from "@anchr/protocol/nostr";
import { generateEphemeralIdentity } from "./identity.ts";
import { createNostrOracleClient } from "./oracle.ts";
import { waitForFirstEvent } from "./relay-wait.ts";
import {
  createDefaultIdGenerator,
  realClock,
} from "./requests/domain/ports.ts";
import {
  buildQueryRequestEvent,
  buildSelectionFeedbackEvent,
  parseOfferFeedbackEvent,
  parseQueryResponseEvent,
  type QueryRequestPayload,
  type SelectionFeedbackPayload,
} from "@anchr/protocol/events";

/**
 * Default offer-window in milliseconds. The SDK waits this long for
 * provider offers before selecting one.
 */
export const DEFAULT_OFFER_WINDOW_MS = 30_000;

/** Default locktime offset (1 hour) for HTLC-locked tokens. */
export const DEFAULT_LOCKTIME_SECONDS = 3600;

/** Default result-event timeout (5 minutes). */
export const DEFAULT_RESULT_TIMEOUT_MS = 5 * 60_000;

/** Default selector: cheapest offer within the customer's `payment.maxAmount`. */
export function selectCheapestOffer(offers: Offer[]): Offer | null {
  if (offers.length === 0) return null;
  return offers.reduce((min, q) => (q.amountSats < min.amountSats ? q : min));
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
  /**
   * Close the injected relay client's connections. Mirrors
   * `Provider.stop()`: call when the Customer is done so the relay pool
   * does not keep the process alive. Skip it only when the same
   * `relayClient` is shared with another still-active actor.
   */
  close(): Promise<void>;
}

/** Thrown when the customer configuration is rejected at construction time. */
export class CustomerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerConfigError";
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

/** Thrown when no provider sent a (selectable) offer within the configured window. */
export class NoOffersReceivedError extends Error {
  constructor(
    public readonly offerWindowMs: number,
    public readonly receivedCount: number,
  ) {
    super(
      `No selectable offer received within ${offerWindowMs}ms ` +
        `(received ${receivedCount} candidate offer(s) total).`,
    );
    this.name = "NoOffersReceivedError";
  }
}

/** Thrown when the selected provider did not deliver a result before the timeout elapsed. */
export class ResultTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly providerPubkey: string,
  ) {
    super(
      `Provider ${
        providerPubkey.slice(0, 16)
      }… did not deliver a kind 6300 result ` +
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
export function validateCustomerOptions(
  options: unknown,
): asserts options is CustomerOptions {
  if (typeof options !== "object" || options === null) {
    throw new CustomerConfigError("options must be an object");
  }
  const o = options as Record<string, unknown>;
  if (!Array.isArray(o.oracles) || o.oracles.length === 0) {
    throw new CustomerConfigError("oracles must be a non-empty array");
  }
  const oraclePubkeys = new Set<string>();
  for (const entry of o.oracles) {
    if (typeof entry !== "object" || entry === null) {
      throw new CustomerConfigError("oracles entries must be objects");
    }
    const pubkey = "pubkey" in entry ? entry.pubkey : undefined;
    const client = "client" in entry ? entry.client : undefined;
    if (typeof pubkey !== "string" || pubkey.length === 0) {
      throw new CustomerConfigError(
        "oracles entries must include a non-empty pubkey",
      );
    }
    if (oraclePubkeys.has(pubkey)) {
      throw new CustomerConfigError("oracles entries must have unique pubkeys");
    }
    oraclePubkeys.add(pubkey);
    if (client !== undefined) {
      if (typeof client !== "object" || client === null) {
        throw new CustomerConfigError(
          "oracle client overrides must be objects",
        );
      }
      const requestHash = "requestHash" in client
        ? client.requestHash
        : undefined;
      if (typeof requestHash !== "function") {
        throw new CustomerConfigError(
          "oracle clients must expose requestHash",
        );
      }
    }
  }
  if (!Array.isArray(o.relays) || o.relays.length === 0) {
    throw new CustomerConfigError("relays must be a non-empty string array");
  }
  if (typeof o.mint !== "string" || o.mint.length === 0) {
    throw new CustomerConfigError("mint must be a non-empty string");
  }
  if (o.cashuClient === undefined || o.cashuClient === null) {
    throw new CustomerConfigError("cashuClient adapter is required");
  }
  if (o.relayClient === undefined || o.relayClient === null) {
    throw new CustomerConfigError("relayClient adapter is required");
  }
  if (
    o.oracleSelector !== undefined && typeof o.oracleSelector !== "function"
  ) {
    throw new CustomerConfigError(
      "oracleSelector, when provided, must be a function",
    );
  }
  if (o.schemaOptions !== undefined) {
    if (typeof o.schemaOptions !== "object" || o.schemaOptions === null) {
      throw new CustomerConfigError(
        "schemaOptions, when provided, must be an object",
      );
    }
  }
  if (o.stateStore !== undefined) {
    if (typeof o.stateStore !== "object" || o.stateStore === null) {
      throw new CustomerConfigError(
        "stateStore, when provided, must be an object",
      );
    }
    const get = "get" in o.stateStore ? o.stateStore.get : undefined;
    const set = "set" in o.stateStore ? o.stateStore.set : undefined;
    const deleteValue = "delete" in o.stateStore
      ? o.stateStore.delete
      : undefined;
    if (
      typeof get !== "function" ||
      typeof set !== "function" ||
      typeof deleteValue !== "function"
    ) {
      throw new CustomerConfigError(
        "stateStore must expose get, set, and delete methods",
      );
    }
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
  const oracleEntries = [...options.oracles];
  const oraclePubkeys = oracleEntries.map((entry) => entry.pubkey);
  const relays = [...options.relays];
  const mint = options.mint;
  const cashuClient = options.cashuClient;
  const offerWindowMs = options.offerWindowMs ?? DEFAULT_OFFER_WINDOW_MS;
  const resultTimeoutMs = options.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS;
  const oracleSelector = options.oracleSelector ?? pickOracleForRequest;
  const selector = options.offerSelector ?? selectCheapestOffer;
  const verifierAdapters = options.verifierAdapters ?? [];
  const schemaOptions = options.schemaOptions;
  const stateStore = options.stateStore;
  const clock = options.clock ?? realClock;
  const idGenerator = options.idGenerator ?? createDefaultIdGenerator(clock);

  return {
    oracles: oraclePubkeys,
    relays,
    mint,

    close(): Promise<void> {
      options.relayClient.close();
      return Promise.resolve();
    },

    async request(req: RequestOptions): Promise<RequestResult> {
      if (!isSchemaUri(req.spec.schema)) {
        throw new InvalidSchemaUriError(req.spec.schema);
      }
      if (
        !Number.isFinite(req.payment.maxAmount) ||
        !Number.isInteger(req.payment.maxAmount) ||
        req.payment.maxAmount <= 0
      ) {
        throw new CustomerConfigError(
          "payment.maxAmount must be a positive integer",
        );
      }
      if (!Array.isArray(req.sourceProofs)) {
        throw new CustomerConfigError(
          "sourceProofs must be an array of Cashu proofs",
        );
      }

      const expectedOracle = oracleSelector(oraclePubkeys);
      const selectedOracle = findCustomerOracle(oracleEntries, expectedOracle);
      if (selectedOracle === null) {
        throw new CustomerConfigError(
          "oracleSelector returned an oracle outside the whitelist",
        );
      }

      const identity: Keypair = generateEphemeralIdentity();
      const queryId = idGenerator.newQueryId();

      const oracleClient = selectedOracle.client ??
        createNostrOracleClient({
          relayClient: options.relayClient,
          oraclePubkey: selectedOracle.pubkey,
        });
      const { hash } = await oracleClient.requestHash(queryId);

      const relayClient: RelayClient = options.relayClient;

      const requestPayload: QueryRequestPayload = {
        query_id: queryId,
        schema: req.spec.schema,
        customer_pubkey: identity.publicKey,
        oracle_pubkey: expectedOracle,
        max_amount_sats: req.payment.maxAmount,
        // Floored to second granularity so the public payload cannot leak
        // the millisecond publish time to relay observers (ANON-03).
        expires_at: Math.floor((clock.now() + offerWindowMs) / 1000) * 1000,
      };
      const requestEvent = buildQueryRequestEvent(identity, requestPayload, {
        regionCode: req.regionCode,
      });
      const publishResult = await relayClient.publish(requestEvent);

      if (publishResult.successes.length === 0) {
        throw new RelayPublishError(publishResult);
      }
      if (stateStore !== undefined) {
        await writeCustomerState(stateStore, {
          queryId,
          requestEventId: requestEvent.id,
          schema: req.spec.schema,
          status: "request_published",
          updatedAt: clock.now(),
        });
      }

      const offers: Offer[] = [];
      let totalReceived = 0;
      const sub = relayClient.subscribe(
        {
          kinds: [7000],
          "#e": [requestEvent.id],
        },
        (event) => {
          const parsed = parseOfferFeedbackEvent(event);
          if (parsed === null) return;
          totalReceived++;
          if (parsed.amount_sats > req.payment.maxAmount) return;
          if (
            req.provider !== undefined &&
            parsed.provider_pubkey !== req.provider
          ) return;
          offers.push({
            providerPubkey: parsed.provider_pubkey,
            amountSats: parsed.amount_sats,
            offerEventId: event.id,
            receivedAt: clock.now(),
          });
        },
      );

      try {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, offerWindowMs)
        );
      } finally {
        sub.close();
      }

      const selected = selector(offers);
      if (selected === null) {
        throw new NoOffersReceivedError(offerWindowMs, totalReceived);
      }
      if (
        !Number.isFinite(selected.amountSats) ||
        !Number.isInteger(selected.amountSats) ||
        selected.amountSats <= 0
      ) {
        throw new CustomerConfigError(
          "offerSelector returned an invalid offer amount",
        );
      }
      if (selected.amountSats > req.payment.maxAmount) {
        throw new CustomerConfigError(
          "offerSelector returned an offer above payment.maxAmount",
        );
      }

      const locktimeSeconds = Math.floor(clock.now() / 1000) +
        (req.payment.locktimeSeconds ?? DEFAULT_LOCKTIME_SECONDS);
      const initialLock: CashuToken = await cashuClient.buildHtlcLock({
        amountSats: selected.amountSats,
        hashHex: hash,
        customerPubkey: identity.publicKey,
        locktimeSeconds,
        sourceProofs: req.sourceProofs,
      });

      // Pass proofs directly rather than re-decoding the broadcast token:
      // the encoded V4 form truncates keyset IDs and would require wallet
      // keychain access to map them back.
      const boundLock: CashuToken = await cashuClient.bindProvider({
        initialProofs: initialLock.proofs,
        providerPubkey: selected.providerPubkey,
        hashHex: hash,
        locktimeSeconds,
        customerPubkey: identity.publicKey,
        customerSecretKey: identity.secretKey,
      });
      if (boundLock.amountSats !== selected.amountSats) {
        throw new CustomerConfigError(
          "bound Payment Lock amount does not match the selected offer amount",
        );
      }

      const selectionPayload: SelectionFeedbackPayload = {
        status: "processing",
        selected_provider_pubkey: selected.providerPubkey,
        provider_redemption_token: boundLock.token,
        execution: {
          schema: req.spec.schema,
          predicate: req.spec.predicate,
          description: req.spec.description,
          context: req.spec.context,
          mint_url: mint,
          max_amount_sats: req.payment.maxAmount,
          locktime_seconds: locktimeSeconds,
        },
      };
      const selectionEvent = buildSelectionFeedbackEvent(
        identity,
        requestEvent.id,
        selectionPayload,
      );
      await relayClient.publish(selectionEvent);
      if (stateStore !== undefined) {
        await writeCustomerState(stateStore, {
          queryId,
          requestEventId: requestEvent.id,
          schema: req.spec.schema,
          status: "provider_selected",
          providerPubkey: selected.providerPubkey,
          offerEventId: selected.offerEventId,
          updatedAt: clock.now(),
        });
      }

      const resultEvent: NostrEvent | null = await waitForFirstEvent(
        relayClient,
        {
          kinds: [6300],
          "#e": [requestEvent.id],
          authors: [selected.providerPubkey],
        },
        (event) => event,
        resultTimeoutMs,
      ).result;
      if (resultEvent === null) {
        throw new ResultTimeoutError(resultTimeoutMs, selected.providerPubkey);
      }

      const response = parseQueryResponseEvent(
        resultEvent,
        identity.secretKey,
        selected.providerPubkey,
      );
      if (response === null) {
        throw new ResultTimeoutError(
          resultTimeoutMs,
          selected.providerPubkey,
        );
      }

      const verifier = resolveVerifierAdapter(
        verifierAdapters,
        req.spec.schema,
      );
      if (verifier !== null) {
        const ok = await Promise.resolve(
          verifier.verify(response.proof, req.spec.predicate, response.data, {
            options: schemaOptions?.[req.spec.schema],
          }),
        );
        if (!ok) {
          throw new SchemaVerificationError(req.spec.schema);
        }
      }

      const result = {
        data: response.data,
        proof: response.proof,
        providerPubkey: selected.providerPubkey,
        schema: response.schema,
      };
      if (stateStore !== undefined) {
        await writeCustomerState(stateStore, {
          queryId,
          requestEventId: requestEvent.id,
          schema: req.spec.schema,
          status: "result_received",
          providerPubkey: selected.providerPubkey,
          offerEventId: selected.offerEventId,
          updatedAt: clock.now(),
        });
      }
      return result;
    },
  };
}

function findCustomerOracle(
  oracles: readonly CustomerOracle[],
  pubkey: string,
): CustomerOracle | null {
  return oracles.find((entry) => entry.pubkey === pubkey) ?? null;
}

type CustomerStateStatus =
  | "request_published"
  | "provider_selected"
  | "result_received";

interface CustomerStateRecord {
  queryId: string;
  requestEventId: string;
  schema: string;
  status: CustomerStateStatus;
  providerPubkey?: string;
  offerEventId?: string;
  updatedAt: number;
}

function customerStateKey(queryId: string): string {
  return `customer:${queryId}`;
}

async function writeCustomerState(
  store: ActorStateStore,
  record: CustomerStateRecord,
): Promise<void> {
  await store.set(customerStateKey(record.queryId), JSON.stringify(record));
}
