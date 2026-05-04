import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createCustomer,
  CustomerConfigError,
  generateQueryId,
  NoQuotesReceivedError,
  OracleWhitelistMismatchError,
  pickOracleForRequest,
  RelayPublishError,
  selectCheapestQuote,
  validateCustomerOptions,
} from "./customer.ts";
import {
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
} from "./events.ts";
import { generateKeypair } from "./nostr.ts";
import {
  ResultTimeoutError,
  SchemaVerificationError,
} from "./customer.ts";
import { CashuMintError } from "./cashu.ts";
import { InvalidSchemaUriError } from "./schema.ts";
import type { OracleClient } from "./oracle.ts";
import type {
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
} from "./cashu.ts";
import type {
  Event,
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "./nostr.ts";
import type { CustomerOptions, Quote } from "./types.ts";

const ORACLE_A = "a".repeat(64);
const ORACLE_B = "b".repeat(64);
const HASH_HEX = "deadbeef".repeat(8);

function makeOracleClient(overrides?: Partial<OracleClient> & { fixedOracle?: string; fixedHash?: string }): OracleClient {
  return {
    requestHash: overrides?.requestHash ?? (
      async (_queryId: string) => ({
        hash: overrides?.fixedHash ?? HASH_HEX,
        oraclePubkey: overrides?.fixedOracle ?? ORACLE_A,
      })
    ),
  };
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
  oracles: [ORACLE_A, ORACLE_B],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
  oracleClient: makeOracleClient(),
  cashuClient: makeCashuClient(),
  relayClient: makeRelayClient(),
  // Short window so tests don't wait the 30s default.
  quoteWindowMs: 10,
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

test("validateCustomerOptions rejects empty relays array", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), relays: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing mint", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), mint: "" }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing oracleClient", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.oracleClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions accepts missing cashuClient (SDK builds one from mint)", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.cashuClient;
  expect(() => validateCustomerOptions(opts)).not.toThrow();
});

test("validateCustomerOptions rejects a non-object input", () => {
  expect(() => validateCustomerOptions(null)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions(42)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions("string")).toThrow(CustomerConfigError);
});

test("createCustomer exposes oracles / relays / mint as readonly copies", () => {
  const opts = validOptions();
  const customer = createCustomer(opts);
  expect([...customer.oracles]).toEqual(opts.oracles);
  expect([...customer.relays]).toEqual(opts.relays);
  expect(customer.mint).toEqual(opts.mint);
});

test("createCustomer copies arrays so mutating the original does not affect the client", () => {
  const oracles = [ORACLE_A, ORACLE_B];
  const customer = createCustomer({ ...validOptions(), oracles });
  oracles.push("c".repeat(64));
  expect(customer.oracles).toHaveLength(2);
});

test("Customer.request rejects an invalid schema URI synchronously", async () => {
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
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 0 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CustomerConfigError);
});

test("Customer.request calls oracleClient.requestHash", async () => {
  let receivedQueryId = "";
  const oracleClient = makeOracleClient({
    requestHash: async (queryId: string) => {
      receivedQueryId = queryId;
      return { hash: HASH_HEX, oraclePubkey: ORACLE_A };
    },
  });
  const customer = createCustomer({ ...validOptions(), oracleClient, quoteWindowMs: 10 });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow();

  expect(receivedQueryId).toMatch(/^query_\d+_[a-z0-9]+$/);
});

test("Customer.request rejects when oracleClient returns a pubkey not matching the picked oracle", async () => {
  const oracleClient = makeOracleClient({ fixedOracle: ORACLE_B });
  const customer = createCustomer({
    ...validOptions(),
    oracles: [ORACLE_A],
    oracleClient,
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(OracleWhitelistMismatchError);
});

test("Customer.request calls cashuClient.buildHtlcLock with the oracle hash", async () => {
  const recorder: { params: BuildHtlcLockParams | null } = { params: null };
  const cashuClient = makeCashuClient({
    buildHtlcLock: async (params: BuildHtlcLockParams): Promise<CashuToken> => {
      recorder.params = params;
      return { token: "cashuBlocked", amountSats: params.amountSats, proofs: [] };
    },
  });
  const customer = createCustomer({ ...validOptions(), cashuClient, quoteWindowMs: 10 });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1234 },
      sourceProofs: [{ id: "proof1" }],
    }),
  ).rejects.toThrow();

  expect(recorder.params).not.toBe(null);
  if (recorder.params === null) throw new Error("unreachable");
  expect(recorder.params.amountSats).toBe(1234);
  expect(recorder.params.hashHex).toBe(HASH_HEX);
  expect(recorder.params.customerPubkey).toMatch(/^[0-9a-f]{64}$/);
  expect(recorder.params.locktimeSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(recorder.params.sourceProofs).toHaveLength(1);
});

test("Customer.request propagates CashuMintError from buildHtlcLock", async () => {
  const cashuClient = makeCashuClient({
    buildHtlcLock: () => Promise.reject(new CashuMintError("simulated mint failure")),
  });
  const customer = createCustomer({ ...validOptions(), cashuClient });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuMintError);
});

test("Customer.request throws NoQuotesReceivedError when no quotes arrive in the window", async () => {
  const customer = createCustomer({ ...validOptions(), quoteWindowMs: 10 });
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: { foo: "bar" } },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(NoQuotesReceivedError);
});

test("Customer.request publishes a kind 5300 Job Request event via relayClient", async () => {
  const recorder: { event: Event | null } = { event: null };
  const relayClient = makeRelayClient({
    publish: async (event: Event): Promise<PublishResult> => {
      recorder.event = event;
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });
  const customer = createCustomer({ ...validOptions(), relayClient, quoteWindowMs: 10 });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: { foo: "bar" } },
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
          onEvent(buildQuoteFeedbackEvent(provider, id, "00".repeat(32), {
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
            schema: "io.anchr.tlsn-https.v1",
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
    relayClient,
    quoteWindowMs: 30,
    resultTimeoutMs: 1000,
  });

  const result = await customer.request({
    spec: { schema: "io.anchr.tlsn-https.v1", predicate: { foo: "bar" } },
    payment: { maxAmount: 1000 },
    sourceProofs: [],
  });

  expect(result.providerPubkey).toBe(provider.publicKey);
  expect(result.schema).toBe("io.anchr.tlsn-https.v1");
  expect(result.data).toEqual({ hello: "world" });
  expect(result.proof).toBe("base64proofbytes==");
});

test("Customer.request runs schemaVerifiers when provided", async () => {
  const provider = generateKeypair();
  const requestEventId: { id: string | null } = { id: null };
  const customerEphemeralPubkey: { value: string | null } = { value: null };
  const verifierCalls: { proof: unknown; predicate: unknown; data: unknown }[] = [];

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
          onEvent(buildQuoteFeedbackEvent(provider, requestEventId.id ?? "x", "00".repeat(32), {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 100,
          }));
        });
      } else if (filterKinds.includes(6300)) {
        queueMicrotask(() => {
          onEvent(buildQueryResponseEvent(
            provider,
            requestEventId.id ?? "x",
            customerEphemeralPubkey.value ?? "00".repeat(32),
            { schema: "io.anchr.tlsn-https.v1", data: { ok: true }, proof: "p1" },
          ));
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    quoteWindowMs: 30,
    resultTimeoutMs: 1000,
    schemaVerifiers: {
      "io.anchr.tlsn-https.v1": (proof, predicate, data) => {
        verifierCalls.push({ proof, predicate, data });
        return true;
      },
    },
  });

  await customer.request({
    spec: { schema: "io.anchr.tlsn-https.v1", predicate: { x: 1 } },
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
          onEvent(buildQuoteFeedbackEvent(provider, requestEventId.id ?? "x", "00".repeat(32), {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 100,
          }));
        });
      } else if (filterKinds.includes(6300)) {
        queueMicrotask(() => {
          onEvent(buildQueryResponseEvent(
            provider,
            requestEventId.id ?? "x",
            customerPub.value ?? "00".repeat(32),
            { schema: "io.anchr.tlsn-https.v1", data: { x: 1 }, proof: "fake" },
          ));
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    quoteWindowMs: 30,
    resultTimeoutMs: 1000,
    schemaVerifiers: { "io.anchr.tlsn-https.v1": () => false },
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
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
          onEvent(buildQuoteFeedbackEvent(provider, requestEventId.id ?? "x", "00".repeat(32), {
            status: "payment-required",
            provider_pubkey: provider.publicKey,
            amount_sats: 100,
          }));
        });
      }
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    quoteWindowMs: 20,
    resultTimeoutMs: 50,
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(ResultTimeoutError);
});

test("Customer.request collects quotes, picks cheapest, binds HTLC, and publishes selection", async () => {
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
        const quoteA = buildQuoteFeedbackEvent(providerA, requestId, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: providerA.publicKey,
          amount_sats: 800,
        });
        const quoteB = buildQuoteFeedbackEvent(providerB, requestId, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: providerB.publicKey,
          amount_sats: 500,
        });
        onEvent(quoteA);
        onEvent(quoteB);
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
    quoteWindowMs: 30,
    resultTimeoutMs: 50,
  });

  // No kind 6300 result delivered → flow times out after selection.
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(ResultTimeoutError);

  expect(bindRecorder.params).not.toBe(null);
  if (bindRecorder.params === null) throw new Error("unreachable");
  expect(bindRecorder.params.providerPubkey).toBe(providerB.publicKey); // cheapest
  // Phase-2 receives the Phase-1 proofs directly (passed by value through
  // the Customer flow rather than re-decoded from the broadcast token).
  expect(bindRecorder.params.initialProofs).toEqual([]);

  // Two events published: kind 5300 request + kind 7000 selection.
  expect(publishedEvents).toHaveLength(2);
  expect(publishedEvents[0].kind).toBe(5300);
  expect(publishedEvents[1].kind).toBe(7000);
});

test("Customer.request rejects quotes above the maxAmount budget", async () => {
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
        const expensive = buildQuoteFeedbackEvent(provider, id, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: provider.publicKey,
          amount_sats: 9999, // over budget
        });
        onEvent(expensive);
      });
      return { close: () => {} };
    },
  });

  const customer = createCustomer({
    ...validOptions(),
    relayClient,
    quoteWindowMs: 20,
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(NoQuotesReceivedError);
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
        // The "wrong" provider quotes too; the customer must reject it.
        onEvent(buildQuoteFeedbackEvent(otherProvider, id, "00".repeat(32), {
          status: "payment-required",
          provider_pubkey: otherProvider.publicKey,
          amount_sats: 100,
        }));
        onEvent(buildQuoteFeedbackEvent(wantedProvider, id, "00".repeat(32), {
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
    quoteWindowMs: 30,
    resultTimeoutMs: 50,
  });

  // No kind 6300 result delivered → flow times out after selection.
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
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
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
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

test("selectCheapestQuote returns null on empty input", () => {
  expect(selectCheapestQuote([])).toBe(null);
});

test("selectCheapestQuote picks the lowest amount", () => {
  const quotes: Quote[] = [
    { providerPubkey: "a", amountSats: 1000, quoteEventId: "ea", receivedAt: 1 },
    { providerPubkey: "b", amountSats: 500, quoteEventId: "eb", receivedAt: 2 },
    { providerPubkey: "c", amountSats: 750, quoteEventId: "ec", receivedAt: 3 },
  ];
  expect(selectCheapestQuote(quotes)?.providerPubkey).toBe("b");
});

test("generateQueryId produces unique identifiers", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) ids.add(generateQueryId());
  expect(ids.size).toBe(50);
});

test("generateQueryId follows the documented shape", () => {
  expect(generateQueryId()).toMatch(/^query_\d+_[a-z0-9]+$/);
});
