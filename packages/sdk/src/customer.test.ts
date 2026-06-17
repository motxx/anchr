import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createCustomer,
  CustomerConfigError,
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
  parseSelectionFeedbackEvent,
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
        proofs: [{ amount: _p.amountSats }],
      })
    ),
    bindProvider: overrides?.bindProvider ?? (
      async (_p: BindProviderParams): Promise<CashuToken> => ({
        token: "cashuBbound",
        amountSats: sumTestProofAmounts(_p.initialProofs),
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

function sumTestProofAmounts(proofs: unknown[]): number {
  return proofs.reduce<number>((sum, proof) => {
    if (
      typeof proof === "object" &&
      proof !== null &&
      "amount" in proof &&
      typeof proof.amount === "number"
    ) {
      return sum + proof.amount;
    }
    return sum;
  }, 0);
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

test("validateCustomerOptions accepts oracle entries without a client (relay-DM default)", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      oracles: [{ pubkey: ORACLE_A }],
    })
  ).not.toThrow();
});

test("validateCustomerOptions rejects malformed oracle client overrides", () => {
  expect(() =>
    validateCustomerOptions({
      ...validOptions(),
      oracles: [{ pubkey: ORACLE_A, client: { requestHash: 42 } }],
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

test("Customer.request rejects invalid maxAmount", async () => {
  const customer = createCustomer(validOptions());
  for (const maxAmount of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    await expect(
      customer.request({
        spec: {
          schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
          predicate: {},
        },
        payment: { maxAmount },
        sourceProofs: [],
      }),
    ).rejects.toThrow(CustomerConfigError);
  }
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

test("Customer.request builds the Payment Lock for the selected offer amount", async () => {
  const provider = generateKeypair();
  const recorder: { params: BuildHtlcLockParams | null } = { params: null };
  const requestEventId: { id: string | null } = { id: null };
  const clockValues = [
    1_700_000_000_000,
    1_700_000_000_100,
    1_700_000_030_000,
  ];
  let clockCalls = 0;
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (event: Event) => void) => {
      queueMicrotask(() => {
        onEvent(buildOfferFeedbackEvent(
          provider,
          requestEventId.id ?? "unknown",
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 456,
          },
        ));
      });
      return { close: () => {} };
    },
  });
  const cashuClient = makeCashuClient({
    buildHtlcLock: async (params: BuildHtlcLockParams): Promise<CashuToken> => {
      recorder.params = params;
      return {
        token: "cashuBlocked",
        amountSats: params.amountSats,
        proofs: [{ amount: params.amountSats }],
      };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 30,
    resultTimeoutMs: 50,
    clock: {
      now: () => clockValues[Math.min(clockCalls++, clockValues.length - 1)],
    },
  });

  await expect(
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1234, locktimeSeconds: 42 },
      sourceProofs: [{ id: "proof1" }],
    }),
  ).rejects.toThrow(ResultTimeoutError);

  expect(recorder.params).not.toBe(null);
  if (recorder.params === null) throw new Error("unreachable");
  expect(recorder.params.amountSats).toBe(456);
  expect(recorder.params.hashHex).toBe(HASH_HEX);
  expect(recorder.params.customerPubkey).toMatch(/^[0-9a-f]{64}$/);
  expect(recorder.params.locktimeSeconds).toBe(1_700_000_030 + 42);
  expect(recorder.params.sourceProofs).toHaveLength(1);
});

test("Customer.request propagates payment adapter errors from buildHtlcLock", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (event: Event) => void) => {
      queueMicrotask(() => {
        onEvent(buildOfferFeedbackEvent(
          provider,
          requestEventId.id ?? "unknown",
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 100,
          },
        ));
      });
      return { close: () => {} };
    },
  });
  const cashuClient = makeCashuClient({
    buildHtlcLock: () =>
      Promise.reject(new TestCashuMintError("simulated mint failure")),
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 30,
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
  const content = JSON.parse(recorder.event.content) as Record<
    string,
    unknown
  >;
  expect(content.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(content.max_amount_sats).toBe(500);
  expect(content).not.toHaveProperty("predicate");
  expect(content).not.toHaveProperty("mint_url");
  expect(content).not.toHaveProperty("payment_lock_token");
  expect(content).not.toHaveProperty("provider_redemption_token");
  expect(content).not.toHaveProperty("locktime_seconds");
});

test("Customer.request publishes expires_at floored to second granularity", async () => {
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
    clock: { now: () => 1_700_000_000_123 },
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
  const content = JSON.parse(recorder.event.content) as Record<
    string,
    unknown
  >;
  expect(content.expires_at).toBe(1_700_000_000_000);
  if (typeof content.expires_at !== "number") {
    throw new Error("expires_at must be a number");
  }
  expect(content.expires_at % 1000).toBe(0);
});

test("Customer.request happy path: returns the verified data + proof from a provider", async () => {
  const provider = generateKeypair();
  const changeProofs = [{ amount: 500, id: "change-proof" }];
  const observedChangeProofs: unknown[] = [];
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
    cashuClient: makeCashuClient({
      buildHtlcLock: async (
        params: BuildHtlcLockParams,
      ): Promise<CashuToken> => ({
        token: "cashuBfake",
        amountSats: params.amountSats,
        proofs: [{ amount: params.amountSats }],
        changeProofs,
      }),
    }),
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
    onPaymentChange: (proofs) => {
      observedChangeProofs.push(...proofs);
    },
  });

  expect(result.providerPubkey).toBe(provider.publicKey);
  expect(result.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(result.data).toEqual({ hello: "world" });
  expect(result.proof).toBe("base64proofbytes==");
  expect(observedChangeProofs).toEqual(changeProofs);
  expect(result.paymentChangeProofs).toEqual(changeProofs);

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
  const changeProofs = [{ amount: 500, id: "change-proof" }];
  const observedChangeProofs: unknown[] = [];

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
    buildHtlcLock: async (
      params: BuildHtlcLockParams,
    ): Promise<CashuToken> => ({
      token: "cashuBfake",
      amountSats: params.amountSats,
      proofs: [{ amount: params.amountSats }],
      changeProofs,
    }),
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
      onPaymentChange: (proofs) => {
        observedChangeProofs.push(...proofs);
      },
    }),
  ).rejects.toThrow(ResultTimeoutError);

  expect(observedChangeProofs).toEqual(changeProofs);
  expect(bindRecorder.params).not.toBe(null);
  if (bindRecorder.params === null) throw new Error("unreachable");
  expect(bindRecorder.params.providerPubkey).toBe(providerB.publicKey);
  expect(bindRecorder.params.initialProofs).toEqual([{ amount: 500 }]);

  expect(publishedEvents).toHaveLength(2);
  expect(publishedEvents[0].kind).toBe(5300);
  expect(publishedEvents[1].kind).toBe(7000);
  expect(publishedEvents[1].content.includes("cashuBbound")).toBe(false);
  expect(publishedEvents[1].tags).toContainEqual([
    "p",
    providerB.publicKey,
  ]);
  expect(publishedEvents[1].tags).toContainEqual(["status", "processing"]);
  const selection = parseSelectionFeedbackEvent(
    publishedEvents[1],
    providerB.secretKey,
    publishedEvents[1].pubkey,
  );
  expect(selection?.provider_redemption_token).toBe("cashuBbound");
  expect(selection?.execution.schema).toBe(
    "https://anchr-spec.org/spec/proof/tlsn/v1",
  );
  expect(selection?.execution.predicate).toEqual({});
  expect(selection?.execution.mint_url).toBe("https://mint.example.org");
  expect(selection?.execution.max_amount_sats).toBe(1000);
  expect(selection?.execution.locktime_seconds).toBeGreaterThan(
    Math.floor(Date.now() / 1000),
  );
});

test("Customer.request rejects an underfunded bound Payment Lock before publishing selection", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const publishedEvents: Event[] = [];
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      publishedEvents.push(event);
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      queueMicrotask(() => {
        onEvent(buildOfferFeedbackEvent(
          provider,
          requestEventId.id ?? "unknown",
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 500,
          },
        ));
      });
      return { close: () => {} };
    },
  });
  const cashuClient = makeCashuClient({
    bindProvider: async (_p: BindProviderParams): Promise<CashuToken> => ({
      token: "cashuBunderfunded",
      amountSats: 498,
      proofs: [],
    }),
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 30,
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

  expect(publishedEvents).toHaveLength(1);
  expect(publishedEvents[0].kind).toBe(5300);
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

test("Customer.request rejects invalid selector amounts before locking", async () => {
  for (
    const amountSats of [
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]
  ) {
    const provider = generateKeypair();
    const requestEventId: { id: string | null } = { id: null };
    const recorder = { buildCalled: false };
    const relayClient = makeRelayClient({
      publish: async (event: Event): Promise<PublishResult> => {
        if (event.kind === 5300) requestEventId.id = event.id;
        return { successes: ["wss://relay.example.org"], failures: [] };
      },
      subscribe: (
        _filter: Filter,
        onEvent: (e: Event) => void,
      ): Subscription => {
        queueMicrotask(() => {
          onEvent(buildOfferFeedbackEvent(
            provider,
            requestEventId.id ?? "unknown",
            "00".repeat(32),
            {
              status: "payment-required",
              provider_pubkey: provider.publicKey,
              amount_sats: 500,
            },
          ));
        });
        return { close: () => {} };
      },
    });
    const cashuClient = makeCashuClient({
      buildHtlcLock: async (
        params: BuildHtlcLockParams,
      ): Promise<CashuToken> => {
        recorder.buildCalled = true;
        return {
          token: "cashuBlocked",
          amountSats: params.amountSats,
          proofs: [],
        };
      },
    });
    const customer = createCustomer({
      ...validOptions(),
      relayClient,
      cashuClient,
      offerWindowMs: 20,
      offerSelector: (_offers) => ({
        providerPubkey: provider.publicKey,
        amountSats,
        offerEventId: "fabricated",
        receivedAt: Date.now(),
      }),
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
    expect(recorder.buildCalled).toBe(false);
  }
});

test("Customer.request rejects selector results above the maxAmount budget before locking", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const recorder = { buildCalled: false };
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      if (event.kind === 5300) requestEventId.id = event.id;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      queueMicrotask(() => {
        onEvent(buildOfferFeedbackEvent(
          provider,
          requestEventId.id ?? "unknown",
          "00".repeat(32),
          {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 500,
          },
        ));
      });
      return { close: () => {} };
    },
  });
  const cashuClient = makeCashuClient({
    buildHtlcLock: async (params: BuildHtlcLockParams): Promise<CashuToken> => {
      recorder.buildCalled = true;
      return {
        token: "cashuBlocked",
        amountSats: params.amountSats,
        proofs: [],
      };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    cashuClient,
    offerWindowMs: 20,
    offerSelector: (_offers) => ({
      providerPubkey: provider.publicKey,
      amountSats: 1500,
      offerEventId: "fabricated",
      receivedAt: Date.now(),
    }),
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
  expect(recorder.buildCalled).toBe(false);
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

test("INV-07: two sequential requests publish under distinct ephemeral pubkeys", async () => {
  const published: Event[] = [];
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });
  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    offerWindowMs: 10,
  });
  const req = () =>
    customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: {},
      },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    });

  await expect(req()).rejects.toThrow(NoOffersReceivedError);
  await expect(req()).rejects.toThrow(NoOffersReceivedError);

  const requests = published
    .map((event) => ({ event, payload: parseQueryRequestEvent(event) }))
    .filter((entry) => entry.payload !== null);
  expect(requests.length).toBe(2);
  const [first, second] = requests;
  expect(first.event.pubkey).not.toBe(second.event.pubkey);
  expect(first.payload!.customer_pubkey).not.toBe(
    second.payload!.customer_pubkey,
  );
  expect(first.payload!.customer_pubkey).toBe(first.event.pubkey);
  expect(second.payload!.customer_pubkey).toBe(second.event.pubkey);
});

test("Customer.close() closes the injected relay client", async () => {
  let closed = 0;
  const customer = createCustomer({
    ...validOptions(),
    relayClient: makeRelayClient({ close: () => closed++ }),
  });

  await customer.close();
  expect(closed).toBe(1);
});
