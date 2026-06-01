import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createCustomer,
  CustomerConfigError,
  generateQueryId,
  NoOffersReceivedError,
  pickOracleForRequest,
  RelayPublishError,
  selectCheapestOffer,
  validateCustomerOptions,
} from "./customer.ts";
import {
  buildOfferFeedbackEvent,
  buildQueryResponseEvent,
  parseQueryRequestEvent,
} from "@anchr/protocol/events";
import { generateKeypair } from "@anchr/protocol/nostr";
import { ResultTimeoutError, SchemaVerificationError } from "./customer.ts";
import { InvalidSchemaUriError } from "./schema.ts";
import type { OracleClient } from "./oracle.ts";
import type {
  ActorStateStore,
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  CashuToken,
  Filter,
  PublishResult,
  RedeemHtlcParams,
  RedeemResult,
  RelayClient,
  Subscription,
} from "./adapters/types.ts";
import type { Event } from "@anchr/protocol/nostr";
import type {
  CustomerOptions,
  CustomerOracle,
  Offer,
} from "./customer-types.ts";

const ORACLE_A = "a".repeat(64);
const ORACLE_B = "b".repeat(64);
const HASH_HEX = "deadbeef".repeat(8);

class TestCashuMintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestCashuMintError";
  }
}

function createMemoryStateStore(): ActorStateStore {
  const values = new Map<string, string>();
  return {
    get(key) {
      return Promise.resolve(values.get(key) ?? null);
    },
    set(key, value) {
      values.set(key, value);
      return Promise.resolve();
    },
    delete(key) {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

function makeOracleClient(
  overrides?: Partial<OracleClient> & {
    fixedHash?: string;
  },
): OracleClient {
  return {
    requestHash: overrides?.requestHash ?? (
      async (_queryId: string) => ({
        hash: overrides?.fixedHash ?? HASH_HEX,
      })
    ),
  };
}

function makeCustomerOracle(
  pubkey: string,
  client: OracleClient = makeOracleClient(),
): CustomerOracle {
  return { pubkey, client };
}

function makeCashuClient(overrides?: Partial<CashuClient>): CashuClient {
  return {
    mintUrl: overrides?.mintUrl ?? "https://mint.example.org",
    buildHtlcLock: overrides?.buildHtlcLock ?? (
      async (_p: BuildHtlcLockParams): Promise<CashuToken> => ({
        token: "cashuBfake",
        amountSats: _p.amountSats,
        proofs: [],
      })
    ),
    bindProvider: overrides?.bindProvider ?? (
      async (_p: BindProviderParams): Promise<CashuToken> => ({
        token: "cashuBbound",
        amountSats: 0,
        proofs: [],
      })
    ),
    redeemHtlc: overrides?.redeemHtlc ?? (
      async (_p: RedeemHtlcParams): Promise<RedeemResult> => ({
        proofs: [],
        amountSats: 0,
      })
    ),
  };
}

function makeRelayClient(overrides?: Partial<RelayClient>): RelayClient {
  return {
    publish: overrides?.publish ?? (
      async (_event: Event): Promise<PublishResult> => ({
        successes: ["wss://relay.example.org"],
        failures: [],
      })
    ),
    subscribe: overrides?.subscribe ?? (
      (_filter: Filter, _onEvent: (event: Event) => void): Subscription => ({
        close: () => {},
      })
    ),
    close: overrides?.close ?? (() => {}),
  };
}

const validOptions = (): CustomerOptions => ({
  oracles: [
    makeCustomerOracle(ORACLE_A),
    makeCustomerOracle(ORACLE_B),
  ],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
  cashuClient: makeCashuClient(),
  relayClient: makeRelayClient(),
  // Short window so tests don't wait the 30s default.
  offerWindowMs: 10,
});

test("validateCustomerOptions accepts a well-formed options object", () => {
  expect(() => validateCustomerOptions(validOptions())).not.toThrow();
});

test("validateCustomerOptions rejects empty oracles array", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), oracles: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty oracle entries", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), oracles: [""] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects oracle entries without a client", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      oracles: [{ pubkey: ORACLE_A }],
    })
  ).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects duplicate oracle pubkeys", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      oracles: [
        makeCustomerOracle(ORACLE_A),
        makeCustomerOracle(ORACLE_A),
      ],
    })
  ).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty relays array", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), relays: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing mint", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), mint: "" }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing cashuClient adapter", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.cashuClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing relayClient adapter", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.relayClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects malformed stateStore adapter", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      stateStore: { get: () => Promise.resolve(null) },
    })
  ).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects malformed oracleSelector", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      oracleSelector: "not-a-function",
    })
  ).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects a non-object input", () => {
  expect(() => validateCustomerOptions(null)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions(42)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions("string")).toThrow(CustomerConfigError);
});

test("createCustomer exposes oracles / relays / mint as readonly copies", () => {
  const opts = validOptions();
  const customer = createCustomer(opts);
  expect([...customer.oracles]).toEqual([ORACLE_A, ORACLE_B]);
  expect([...customer.relays]).toEqual(opts.relays);
  expect(customer.mint).toEqual(opts.mint);
});

test("createCustomer copies arrays so mutating the original does not affect the client", () => {
  const oracles = [
    makeCustomerOracle(ORACLE_A),
    makeCustomerOracle(ORACLE_B),
  ];
  const customer = createCustomer({ ...validOptions(), oracles });
  oracles.push(makeCustomerOracle("c".repeat(64)));
  expect(customer.oracles).toHaveLength(2);
});

test("Customer.request rejects an invalid schema URL synchronously", async () => {
  const customer = createCustomer(validOptions());
  await expect(
    customer.request({
      spec: { schema: "not-a-valid-uri", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(InvalidSchemaUriError);
});

test("Customer.request rejects non-positive maxAmount", async () => {
  const customer = createCustomer(validOptions());
  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 0 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CustomerConfigError);
});

test("Customer.request calls the selected oracle client's requestHash", async () => {
  let receivedQueryId = "";
  const oracleClient = makeOracleClient({
    requestHash: async (queryId: string) => {
      receivedQueryId = queryId;
      return { hash: HASH_HEX };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    oracles: [
      makeCustomerOracle(ORACLE_A, oracleClient),
      makeCustomerOracle(ORACLE_B),
    ],
    offerWindowMs: 10,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow();

  expect(receivedQueryId).toMatch(/^query_\d+_[a-z0-9]+$/);
});

test("Customer.request can select a non-first trusted oracle", async () => {
  const recorder: {
    selectedClientCalled: boolean;
    publishedOracle: string | null;
  } = {
    selectedClientCalled: false,
    publishedOracle: null,
  };
  const oracleClient = makeOracleClient({
    requestHash: async (_queryId: string) => {
      recorder.selectedClientCalled = true;
      return { hash: HASH_HEX };
    },
  });
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) {
        recorder.publishedOracle =
          parseQueryRequestEvent(event)?.oracle_pubkey ??
            null;
      }
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    oracles: [
      makeCustomerOracle(ORACLE_A),
      makeCustomerOracle(ORACLE_B, oracleClient),
    ],
    relayClient,
    oracleSelector: () => ORACLE_B,
    offerWindowMs: 10,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(NoOffersReceivedError);

  expect(recorder.selectedClientCalled).toBe(true);
  expect(recorder.publishedOracle).toBe(ORACLE_B);
});

test("Customer.request rejects when oracleSelector returns outside the whitelist", async () => {
  const customer = createCustomer({
    ...validOptions(),
    oracleSelector: () => "c".repeat(64),
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CustomerConfigError);
});

test("Customer.request calls cashuClient.buildHtlcLock with the oracle hash", async () => {
  const recorder: { params: BuildHtlcLockParams | null } = { params: null };
  const cashuClient = makeCashuClient({
    buildHtlcLock: async (params: BuildHtlcLockParams): Promise<CashuToken> => {
      recorder.params = params;
      return {
        token: "cashuBlocked",
        amountSats: params.amountSats,
        proofs: [],
      };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    cashuClient,
    offerWindowMs: 10,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1234 },
      sourceProofs: [{ id: "proof1" }],
    }),
  ).rejects.toThrow();

  expect(recorder.params).not.toBe(null);
  if (recorder.params === null) throw new Error("unreachable");
  expect(recorder.params.amountSats).toBe(1234);
  expect(recorder.params.hashHex).toBe(HASH_HEX);
  expect(recorder.params.customerPubkey).toMatch(/^[0-9a-f]{64}$/);
  expect(recorder.params.locktimeSeconds).toBeGreaterThan(
    Math.floor(Date.now() / 1000),
  );
  expect(recorder.params.sourceProofs).toHaveLength(1);
});

test("Customer.request propagates payment adapter errors from buildHtlcLock", async () => {
  const cashuClient = makeCashuClient({
    buildHtlcLock: () =>
      Promise.reject(new TestCashuMintError("simulated mint failure")),
  });
  const customer = createCustomer({ ...validOptions(), cashuClient });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(TestCashuMintError);
});

test("Customer.request throws NoOffersReceivedError when no offers arrive in the window", async () => {
  const customer = createCustomer({ ...validOptions(), offerWindowMs: 10 });
  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: { foo: "bar" },
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(NoOffersReceivedError);
});

test("Customer.request publishes a kind 5300 Job Request event via relayClient", async () => {
  const recorder: { event: Event | null } = { event: null };
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      recorder.event = event;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 10,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: { foo: "bar" },
      },
      payment: { maxAmount: 500 },
      sourceProofs: [],
    }),
  ).rejects.toThrow();

  expect(recorder.event).not.toBe(null);
  if (recorder.event === null) throw new Error("unreachable");
  expect(recorder.event.kind).toBe(5300);
  expect(recorder.event.id).toMatch(/^[0-9a-f]{64}$/);
});

test("Customer.request happy path: returns the verified data + proof from a provider", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const customerEphemeralPubkey: { value: string | null } = { value: null };
  const queryIdRef: { value: string | null } = { value: null };
  const oracleClient = makeOracleClient({
    requestHash: async (queryId: string) => {
      queryIdRef.value = queryId;
      return { hash: HASH_HEX };
    },
  });
  const stateStore = createMemoryStateStore();

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) {
        requestEventId.id = event.id;
        customerEphemeralPubkey.value = event.pubkey;
      }
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      const filterKinds = filter.kinds ?? [];
      if (filterKinds.includes(7000)) {
        queueMicrotask(() => {
          const id = requestEventId.id ?? "unknown";
          onEvent(buildOfferFeedbackEvent(provider, id, "00".repeat(32), {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 500,
          }));
        });
      } else if (filterKinds.includes(6300)) {
        queueMicrotask(() => {
          const id = requestEventId.id ?? "unknown";
          const customerPub = customerEphemeralPubkey.value ?? "00".repeat(32);
          const result = buildQueryResponseEvent(provider, id, customerPub, {
            schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
            data: { hello: "world" },
            proof: "base64proofbytes==",
          });
          onEvent(result);
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    oracles: [
      makeCustomerOracle(ORACLE_A, oracleClient),
      makeCustomerOracle(ORACLE_B),
    ],
    relayClient,
    stateStore,
    offerWindowMs: 30,
    resultTimeoutMs: 1000,
  });

  const result = await customer.request({
    spec: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: { foo: "bar" },
    },
    payment: { maxAmount: 1000 },
    sourceProofs: [],
  });

  expect(result.providerPubkey).toBe(provider.publicKey);
  expect(result.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(result.data).toEqual({ hello: "world" });
  expect(result.proof).toBe("base64proofbytes==");

  if (queryIdRef.value === null) throw new Error("query id was not recorded");
  const stored = await stateStore.get(`customer:${queryIdRef.value}`);
  expect(stored).not.toBe(null);
  if (stored === null) throw new Error("customer state was not stored");
  const parsed = JSON.parse(stored) as Record<string, unknown>;
  expect(parsed.status).toBe("result_received");
  expect(parsed.providerPubkey).toBe(provider.publicKey);
  expect(parsed.requestEventId).toBe(requestEventId.id);
});

test("Customer.request runs verifierAdapters when provided", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const customerEphemeralPubkey: { value: string | null } = { value: null };
  const verifierCalls: { proof: unknown; predicate: unknown; data: unknown }[] =
    [];

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) {
        requestEventId.id = event.id;
        customerEphemeralPubkey.value = event.pubkey;
      }
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      const filterKinds = filter.kinds ?? [];
      if (filterKinds.includes(7000)) {
        queueMicrotask(() => {
          onEvent(
            buildOfferFeedbackEvent(
              provider,
              requestEventId.id ?? "x",
              "00".repeat(32),
              {
                status: "payment-required",
                provider_pubkey: provider.publicKey,
                amount_sats: 100,
              },
            ),
          );
        });
      } else if (filterKinds.includes(6300)) {
        queueMicrotask(() => {
          onEvent(buildQueryResponseEvent(
            provider,
            requestEventId.id ?? "x",
            customerEphemeralPubkey.value ?? "00".repeat(32),
            {
              schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
              data: { ok: true },
              proof: "p1",
            },
          ));
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 30,
    resultTimeoutMs: 1000,
    verifierAdapters: [
      {
        canHandle: (schema) =>
          schema === "https://anchr-spec.org/spec/proof/tlsn/v1",
        verify: (proof, predicate, data) => {
          verifierCalls.push({ proof, predicate, data });
          return true;
        },
      },
    ],
  });

  await customer.request({
    spec: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: { x: 1 },
    },
    payment: { maxAmount: 1000 },
    sourceProofs: [],
  });

  expect(verifierCalls).toHaveLength(1);
  expect(verifierCalls[0].proof).toBe("p1");
  expect(verifierCalls[0].predicate).toEqual({ x: 1 });
  expect(verifierCalls[0].data).toEqual({ ok: true });
});

test("Customer.request throws SchemaVerificationError when verifier returns false", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const customerPub: { value: string | null } = { value: null };

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) {
        requestEventId.id = event.id;
        customerPub.value = event.pubkey;
      }
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      const filterKinds = filter.kinds ?? [];
      if (filterKinds.includes(7000)) {
        queueMicrotask(() => {
          onEvent(
            buildOfferFeedbackEvent(
              provider,
              requestEventId.id ?? "x",
              "00".repeat(32),
              {
                status: "payment-required",
                provider_pubkey: provider.publicKey,
                amount_sats: 100,
              },
            ),
          );
        });
      } else if (filterKinds.includes(6300)) {
        queueMicrotask(() => {
          onEvent(buildQueryResponseEvent(
            provider,
            requestEventId.id ?? "x",
            customerPub.value ?? "00".repeat(32),
            {
              schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
              data: { x: 1 },
              proof: "fake",
            },
          ));
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 30,
    resultTimeoutMs: 1000,
    verifierAdapters: [{
      canHandle: (schema) =>
        schema === "https://anchr-spec.org/spec/proof/tlsn/v1",
      verify: () => false,
    }],
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(SchemaVerificationError);
});

test("Customer.request throws ResultTimeoutError when no result arrives", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      if ((filter.kinds ?? []).includes(7000)) {
        queueMicrotask(() => {
          onEvent(
            buildOfferFeedbackEvent(
              provider,
              requestEventId.id ?? "x",
              "00".repeat(32),
              {
                status: "payment-required",
                provider_pubkey: provider.publicKey,
                amount_sats: 100,
              },
            ),
          );
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 20,
    resultTimeoutMs: 50,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(ResultTimeoutError);
});

test("Customer.request collects offers, picks cheapest, binds HTLC, and publishes selection", async () => {
  const providerA = generateKeypair();
  const providerB = generateKeypair();
  const requestEventRecorder: { id: string | null } = { id: null };
  const publishedEvents: Event[] = [];
  const bindRecorder: { params: BindProviderParams | null } = { params: null };

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      publishedEvents.push(event);
      if (event.kind === 5300) requestEventRecorder.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      queueMicrotask(() => {
        const requestId = requestEventRecorder.id ?? "unknown";
        const offerA = buildOfferFeedbackEvent(
          providerA,
          requestId,
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: providerA.publicKey,
            amount_sats: 800,
          },
        );
        const offerB = buildOfferFeedbackEvent(
          providerB,
          requestId,
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: providerB.publicKey,
            amount_sats: 500,
          },
        );
        onEvent(offerA);
        onEvent(offerB);
      });
      void filter;
      return { close: () => {} };
    },
  });

  const cashuClient = makeCashuClient({
    bindProvider: async (p: BindProviderParams): Promise<CashuToken> => {
      bindRecorder.params = p;
      return { token: "cashuBbound", amountSats: 500, proofs: [] };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 30,
    resultTimeoutMs: 50,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(ResultTimeoutError);

  expect(bindRecorder.params).not.toBe(null);
  if (bindRecorder.params === null) throw new Error("unreachable");
  expect(bindRecorder.params.providerPubkey).toBe(providerB.publicKey);
  expect(bindRecorder.params.initialProofs).toEqual([]);

  expect(publishedEvents).toHaveLength(2);
  expect(publishedEvents[0].kind).toBe(5300);
  expect(publishedEvents[1].kind).toBe(7000);
  expect(publishedEvents[1].content.includes("cashuBbound")).toBe(false);
  expect(publishedEvents[1].tags).toContainEqual([
    "p",
    providerB.publicKey,
  ]);
  expect(publishedEvents[1].tags).toContainEqual(["status", "processing"]);
});

test("Customer.request rejects offers above the maxAmount budget", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      queueMicrotask(() => {
        const id = requestEventId.id ?? "unknown";
        const expensive = buildOfferFeedbackEvent(
          provider,
          id,
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 9999,
          },
        );
        onEvent(expensive);
      });
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 20,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(NoOffersReceivedError);
});

test("Customer.request honors `provider` pinning when set", async () => {
  const wantedProvider = generateKeypair();
  const otherProvider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const bindRecorder: { params: BindProviderParams | null } = { params: null };

  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      queueMicrotask(() => {
        const id = requestEventId.id ?? "unknown";
        onEvent(buildOfferFeedbackEvent(otherProvider, id, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: otherProvider.publicKey,
          amount_sats: 100,
        }));
        onEvent(buildOfferFeedbackEvent(wantedProvider, id, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: wantedProvider.publicKey,
          amount_sats: 500,
        }));
      });
      return { close: () => {} };
    },
  });
  const cashuClient = makeCashuClient({
    bindProvider: async (p) => {
      bindRecorder.params = p;
      return { token: "cashuBbound", amountSats: 500, proofs: [] };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 30,
    resultTimeoutMs: 50,
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
      provider: wantedProvider.publicKey,
    }),
  ).rejects.toThrow(ResultTimeoutError);

  expect(bindRecorder.params).not.toBe(null);
  if (bindRecorder.params === null) throw new Error("unreachable");
  expect(bindRecorder.params.providerPubkey).toBe(wantedProvider.publicKey);
});

test("Customer.request throws RelayPublishError when no relay accepts the event", async () => {
  const relayClient = makeRelayClient({
    publish: async (): Promise<PublishResult> => ({
      successes: [],
      failures: [{ relay: "wss://relay.example.org", reason: "rejected" }],
    }),
  });
  const customer = createCustomer({ ...validOptions(), relayClient });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(RelayPublishError);
});

// --- Pure helpers ---

test("pickOracleForRequest returns the first oracle by default (v0)", () => {
  expect(pickOracleForRequest([ORACLE_A, ORACLE_B])).toBe(ORACLE_A);
});

test("pickOracleForRequest throws on empty whitelist", () => {
  expect(() => pickOracleForRequest([])).toThrow(CustomerConfigError);
});

test("selectCheapestOffer returns null on empty input", () => {
  expect(selectCheapestOffer([])).toBe(null);
});

test("selectCheapestOffer picks the lowest amount", () => {
  const offers: Offer[] = [
    {
      providerPubkey: "a",
      amountSats: 1000,
      offerEventId: "ea",
      receivedAt: 1,
    },
    { providerPubkey: "b", amountSats: 500, offerEventId: "eb", receivedAt: 2 },
    { providerPubkey: "c", amountSats: 750, offerEventId: "ec", receivedAt: 3 },
  ];
  expect(selectCheapestOffer(offers)?.providerPubkey).toBe("b");
});

test("generateQueryId produces unique identifiers", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) ids.add(generateQueryId());
  expect(ids.size).toBe(50);
});

test("generateQueryId follows the documented shape", () => {
  expect(generateQueryId()).toMatch(/^query_\d+_[a-z0-9]+$/);
});
