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
  buildQuoteFeedbackEvent,
} from "./events.ts";
import { generateKeypair } from "./nostr.ts";
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

// --- Test doubles ---

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
  // Short quote window so tests that flow past the publish step
  // don't sit waiting the 30s default.
  quoteWindowMs: 10,
});

// --- Validation ---

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

test("validateCustomerOptions rejects missing cashuClient", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.cashuClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects a non-object input", () => {
  expect(() => validateCustomerOptions(null)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions(42)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions("string")).toThrow(CustomerConfigError);
});

// --- Constructor ---

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

// --- Request flow ---

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
  ).rejects.toThrow(); // wire flow continues but later steps not impl

  expect(receivedQueryId).toMatch(/^query_\d+_[a-z0-9]+$/);
});

test("Customer.request rejects when oracleClient returns a pubkey not matching the picked oracle", async () => {
  const oracleClient = makeOracleClient({ fixedOracle: ORACLE_B });
  // Customer's whitelist[0] is ORACLE_A; oracleClient claims to be ORACLE_B.
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
  // Wrapper object — TypeScript narrows property access through closures
  // more reliably than free `let` variables (which get stuck on the
  // initial-assignment type).
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
  ).rejects.toThrow(); // wire flow continues but later steps not impl

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
  // Default mock subscribe delivers no events; quoteWindowMs=10ms is plenty short.
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
      // The customer subscribes with an `#e` filter referencing the
      // request event. Synchronously deliver two quotes (cheaper one
      // should win) once the subscription is opened.
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
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(/steps 8-11 not implemented/);

  expect(bindRecorder.params).not.toBe(null);
  if (bindRecorder.params === null) throw new Error("unreachable");
  expect(bindRecorder.params.providerPubkey).toBe(providerB.publicKey); // cheapest
  expect(bindRecorder.params.initialToken).toBe("cashuBfake");

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
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
      provider: wantedProvider.publicKey,
    }),
  ).rejects.toThrow(/steps 8-11 not implemented/);

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
