import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  canOfferForRequest,
  createProvider,
  ProviderConfigError,
  validateProviderOptions,
} from "./provider.ts";
import {
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildSelectionFeedbackEvent,
} from "@anchr/protocol/events";
import {
  decryptNip44,
  type Event,
  generateKeypair,
} from "@anchr/protocol/nostr";
import type {
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "./nostr.ts";
import type {
  CashuClient,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
} from "./cashu.ts";
import { bytesToHex } from "./test-helpers.ts";
import { DEFINED_SCHEMAS } from "@anchr/protocol/schema";
import type { ProofGenerator, ProviderOptions } from "./types.ts";
import { createMemoryStateStore } from "./storage.ts";

// --- Test doubles ---

const ORACLE_A = "a".repeat(64);

const customerKey = generateKeypair();
const providerKey = generateKeypair();
const oracleKey = generateKeypair();

function makeCashuClient(overrides?: Partial<CashuClient>): CashuClient {
  return {
    mintUrl: overrides?.mintUrl ?? "https://mint.example.org",
    buildHtlcLock: overrides?.buildHtlcLock ??
      (async (
        p,
      ) => ({
        token: "x",
        amountSats: p.amountSats,
        proofs: [],
      } satisfies CashuToken)),
    bindProvider: overrides?.bindProvider ??
      (async () => ({
        token: "y",
        amountSats: 0,
        proofs: [],
      } satisfies CashuToken)),
    redeemHtlc: overrides?.redeemHtlc ??
      (async (_p: RedeemHtlcParams): Promise<RedeemResult> => ({
        proofs: [],
        amountSats: 0,
      })),
  };
}

function makeRelayClient(overrides?: Partial<RelayClient>): RelayClient {
  return {
    publish: overrides?.publish ??
      (async () => ({ successes: ["wss://relay.example.org"], failures: [] })),
    subscribe: overrides?.subscribe ??
      ((_filter: Filter, _onEvent: (e: Event) => void): Subscription => ({
        close: () => {},
      })),
    close: overrides?.close ?? (() => {}),
  };
}

const validOptions = (): ProviderOptions => ({
  oracles: [ORACLE_A],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
  privKey: bytesToHex(providerKey.secretKey),
  cashuClient: makeCashuClient(),
  relayClient: makeRelayClient(),
});

// --- Validation ---

test("validateProviderOptions accepts a well-formed options object", () => {
  expect(() => validateProviderOptions(validOptions())).not.toThrow();
});

test("validateProviderOptions accepts an optional notary URL", () => {
  expect(() =>
    validateProviderOptions({
      ...validOptions(),
      notary: "wss://notary.example.org",
    })
  ).not.toThrow();
});

test("validateProviderOptions rejects empty oracles array", () => {
  expect(() => validateProviderOptions({ ...validOptions(), oracles: [] }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects empty relays array", () => {
  expect(() => validateProviderOptions({ ...validOptions(), relays: [] }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects missing privKey", () => {
  expect(() => validateProviderOptions({ ...validOptions(), privKey: "" }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects empty-string notary when provided", () => {
  expect(() => validateProviderOptions({ ...validOptions(), notary: "" }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects missing cashuClient adapter", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.cashuClient;
  expect(() => validateProviderOptions(opts)).toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects missing relayClient adapter", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.relayClient;
  expect(() => validateProviderOptions(opts)).toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects malformed stateStore adapter", () => {
  expect(() =>
    validateProviderOptions({
      ...validOptions(),
      stateStore: { set: () => Promise.resolve() },
    })
  ).toThrow(ProviderConfigError);
});

test("validateProviderOptions accepts proof generator adapters", () => {
  const generator: ProofGenerator = {
    canHandle: () => true,
    produce: async () => ({ data: null, proof: "" }),
  };
  expect(() =>
    validateProviderOptions({ ...validOptions(), proofGenerators: [generator] })
  ).not.toThrow();
});

test("validateProviderOptions rejects malformed proof generator adapters", () => {
  expect(() =>
    validateProviderOptions({ ...validOptions(), proofGenerators: [{}] })
  ).toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects a non-object input", () => {
  expect(() => validateProviderOptions(null)).toThrow(ProviderConfigError);
  expect(() => validateProviderOptions(42)).toThrow(ProviderConfigError);
});

// --- Constructor ---

test("createProvider exposes oracles / relays / mint / notary / pubkey as readonly", () => {
  const provider = createProvider({
    ...validOptions(),
    notary: "wss://notary.example.org",
  });
  expect([...provider.oracles]).toEqual([ORACLE_A]);
  expect([...provider.relays]).toEqual(["wss://relay.example.org"]);
  expect(provider.mint).toEqual("https://mint.example.org");
  expect(provider.notary).toEqual("wss://notary.example.org");
  expect(provider.pubkey).toBe(providerKey.publicKey);
});

test("createProvider does not require notary (defaults to undefined)", () => {
  const provider = createProvider(validOptions());
  expect(provider.notary).toBe(undefined);
});

// --- canOfferForRequest helper ---

test("canOfferForRequest returns true when oracle is in whitelist", () => {
  expect(canOfferForRequest(["a", "b", "c"], "b")).toBe(true);
});

test("canOfferForRequest returns false when oracle is not in whitelist", () => {
  expect(canOfferForRequest(["a", "b"], "c")).toBe(false);
});

test("canOfferForRequest returns false on empty whitelist", () => {
  expect(canOfferForRequest([], "a")).toBe(false);
});

// --- Subscription + handler invocation ---

test("Provider.serve subscribes to kind 5300 events on the relays", async () => {
  const subscribed: Filter[] = [];
  const relayClient = makeRelayClient({
    subscribe: (filter: Filter): Subscription => {
      subscribed.push(filter);
      return { close: () => {} };
    },
  });
  const provider = createProvider({ ...validOptions(), relayClient });
  const servePromise = provider.serve(async () => null);
  await new Promise((r) => setTimeout(r, 5));
  await provider.stop();
  await servePromise;
  expect(subscribed).toHaveLength(1);
  expect(subscribed[0].kinds).toEqual([5300]);
});

test("Provider.serve calls handler only for events whose oracle is in the whitelist", async () => {
  const handlerCalls: number[] = [];
  let onEventRef: ((e: Event) => void) | null = null;

  const relayClient = makeRelayClient({
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      onEventRef = onEvent;
      return { close: () => {} };
    },
  });

  const provider = createProvider({ ...validOptions(), relayClient });
  const servePromise = provider.serve(async (req) => {
    handlerCalls.push(req.maxAmountSats);
    return null;
  });

  await new Promise((r) => setTimeout(r, 5));
  if (onEventRef === null) throw new Error("subscribe was not called");
  const onEvent = onEventRef as (e: Event) => void;

  // Event whose oracle IS in our whitelist → handler called.
  const goodEvent = buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  });
  // Event whose oracle is NOT in our whitelist → handler skipped.
  const badEvent = buildQueryRequestEvent(customerKey, {
    query_id: "q2",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: "z".repeat(64),
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 2000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  });
  onEvent(goodEvent);
  onEvent(badEvent);
  await new Promise((r) => setTimeout(r, 10));
  await provider.stop();
  await servePromise;

  expect(handlerCalls).toEqual([1000]);
});

test("Provider.serve prefilters requests with proof generator canHandle", async () => {
  const handlerSchemas: string[] = [];
  let onEventRef: ((e: Event) => void) | null = null;
  const generator: ProofGenerator = {
    canHandle: (schema) => schema === DEFINED_SCHEMAS.TLSN_HTTPS_V1,
    produce: async () => ({ data: { ok: true }, proof: "p1" }),
  };

  const relayClient = makeRelayClient({
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      onEventRef = onEvent;
      return { close: () => {} };
    },
  });

  const provider = createProvider({
    ...validOptions(),
    relayClient,
    proofGenerators: [generator],
  });
  const servePromise = provider.serve(async (req) => {
    handlerSchemas.push(req.spec.schema);
    expect(req.proofGenerator).toBe(generator);
    return null;
  });

  await new Promise((r) => setTimeout(r, 5));
  const onEvent = requireOnEvent(onEventRef);

  onEvent(buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: DEFINED_SCHEMAS.TLSN_HTTPS_V1,
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));
  onEvent(buildQueryRequestEvent(customerKey, {
    query_id: "q2",
    schema: DEFINED_SCHEMAS.C2PA_IMAGE_V1,
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));
  await new Promise((r) => setTimeout(r, 10));
  await provider.stop();
  await servePromise;

  expect(handlerSchemas).toEqual([DEFINED_SCHEMAS.TLSN_HTTPS_V1]);
});

function requireOnEvent(
  onEvent: ((e: Event) => void) | null,
): (e: Event) => void {
  if (onEvent === null) throw new Error("subscribe was not called");
  return onEvent;
}

test("Provider.serve publishes a kind 7000 offer when handler returns a ProviderOffer", async () => {
  const published: Event[] = [];
  let onEventRef: ((e: Event) => void) | null = null;

  const relayClient = makeRelayClient({
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      // Capture only the request subscription (kinds: [5300]); ignore
      // the per-job selection subscription so its timeout fires fast.
      if ((filter.kinds ?? []).includes(5300)) onEventRef = onEvent;
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const provider = createProvider({
    ...validOptions(),
    relayClient,
    selectionTimeoutMs: 30,
  });
  const servePromise = provider.serve(async () => ({
    amountSats: 250,
    produce: async () => ({ data: null, proof: "p" }),
  }));

  await new Promise((r) => setTimeout(r, 5));
  if (onEventRef === null) throw new Error("subscribe was not called");
  const onEvent = onEventRef as (e: Event) => void;

  onEvent(buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));
  // Wait long enough for the per-job selection timeout (30ms) to fire,
  // so no setTimeout leaks across to the test runner.
  await new Promise((r) => setTimeout(r, 60));
  await provider.stop();
  await servePromise;

  expect(published).toHaveLength(1);
  expect(published[0].kind).toBe(7000);
  expect(published[0].pubkey).toBe(providerKey.publicKey);
});

test("Provider.serve declines requests where handler returns null (no publish)", async () => {
  const published: Event[] = [];
  let onEventRef: ((e: Event) => void) | null = null;

  const relayClient = makeRelayClient({
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      onEventRef = onEvent;
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const provider = createProvider({ ...validOptions(), relayClient });
  const servePromise = provider.serve(async () => null);

  await new Promise((r) => setTimeout(r, 5));
  if (onEventRef === null) throw new Error("subscribe was not called");
  const onEvent = onEventRef as (e: Event) => void;

  onEvent(buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));
  await new Promise((r) => setTimeout(r, 10));
  await provider.stop();
  await servePromise;

  expect(published).toHaveLength(0);
});

test("Provider.serve waits for selection, runs producer, and publishes encrypted kind 6300 result", async () => {
  const published: Event[] = [];
  let onRequestEvent: ((e: Event) => void) | null = null;
  let onSelectionEvent: ((e: Event) => void) | null = null;
  let producerCalled = false;

  const relayClient = makeRelayClient({
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      // First subscription is the request listener (kind 5300 only).
      // Second subscription (per job) is the selection listener
      // (kinds: [7000], #e: [requestId], authors: [customer]).
      const kinds = filter.kinds ?? [];
      if (kinds.includes(5300)) {
        onRequestEvent = onEvent;
      } else if (kinds.includes(7000)) {
        onSelectionEvent = onEvent;
      }
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const provider = createProvider({
    ...validOptions(),
    relayClient,
    selectionTimeoutMs: 200,
    preimageTimeoutMs: 30,
  });
  const servePromise = provider.serve(async () => ({
    amountSats: 200,
    produce: async () => {
      producerCalled = true;
      return { data: { hello: "world" }, proof: "pf-bytes" };
    },
  }));

  await new Promise((r) => setTimeout(r, 5));
  if (onRequestEvent === null) {
    throw new Error("request subscribe was not called");
  }
  const fireRequest = onRequestEvent as (e: Event) => void;

  // Customer sends a request.
  const requestEvent = buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: { foo: "bar" },
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  });
  fireRequest(requestEvent);

  // Wait for the provider to publish its offer and open the selection
  // subscription before we deliver the selection event.
  await new Promise((r) => setTimeout(r, 30));
  if (onSelectionEvent === null) {
    throw new Error("selection subscribe was not called");
  }
  const fireSelection = onSelectionEvent as (e: Event) => void;

  // Customer announces selecting this provider, with a bound token.
  const selectionEvent = buildSelectionFeedbackEvent(
    customerKey,
    requestEvent.id,
    {
      status: "processing",
      selected_provider_pubkey: providerKey.publicKey,
      bound_token: "cashuBbound",
    },
  );
  fireSelection(selectionEvent);

  // Wait for produce + result publish + preimage timeout (30ms) to drain
  // before stopping, so no setTimeout leaks.
  await new Promise((r) => setTimeout(r, 70));
  await provider.stop();
  await servePromise;

  expect(producerCalled).toBe(true);
  // Two publishes from the provider: kind 7000 offer + kind 6300 result.
  expect(published).toHaveLength(2);
  expect(published[0].kind).toBe(7000);
  expect(published[1].kind).toBe(6300);

  // The kind 6300 content is NIP-44-encrypted to the customer.
  const decrypted = decryptNip44(
    published[1].content,
    customerKey.secretKey,
    providerKey.publicKey,
  );
  const payload = JSON.parse(decrypted);
  expect(payload.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(payload.data).toEqual({ hello: "world" });
  expect(payload.proof).toBe("pf-bytes");
});

test("Provider.serve never runs the producer when no selection event arrives within timeout", async () => {
  const published: Event[] = [];
  let onRequestEvent: ((e: Event) => void) | null = null;
  let producerCalled = false;

  const relayClient = makeRelayClient({
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      const kinds = filter.kinds ?? [];
      if (kinds.includes(5300)) {
        onRequestEvent = onEvent;
      }
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const provider = createProvider({
    ...validOptions(),
    relayClient,
    selectionTimeoutMs: 30,
  });
  const servePromise = provider.serve(async () => ({
    amountSats: 100,
    produce: async () => {
      producerCalled = true;
      return { data: null, proof: "x" };
    },
  }));

  await new Promise((r) => setTimeout(r, 5));
  if (onRequestEvent === null) {
    throw new Error("request subscribe was not called");
  }
  (onRequestEvent as (e: Event) => void)(buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));

  // Wait beyond the selection timeout without delivering a selection.
  await new Promise((r) => setTimeout(r, 80));
  await provider.stop();
  await servePromise;

  expect(producerCalled).toBe(false);
  // Only the kind 7000 offer was published; no kind 6300 result.
  expect(published).toHaveLength(1);
  expect(published[0].kind).toBe(7000);
});

test("Provider.serve receives oracle preimage DM and redeems the HTLC", async () => {
  const published: Event[] = [];
  let onRequestEvent: ((e: Event) => void) | null = null;
  let onSelectionEvent: ((e: Event) => void) | null = null;
  let onPreimageEvent: ((e: Event) => void) | null = null;
  const redeemRecorder: { params: RedeemHtlcParams | null } = { params: null };
  const stateStore = createMemoryStateStore();

  const relayClient = makeRelayClient({
    subscribe: (filter: Filter, onEvent: (e: Event) => void): Subscription => {
      const kinds = filter.kinds ?? [];
      if (kinds.includes(5300)) onRequestEvent = onEvent;
      else if (kinds.includes(7000)) onSelectionEvent = onEvent;
      else if (kinds.includes(4)) onPreimageEvent = onEvent;
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const cashuClient = makeCashuClient({
    redeemHtlc: async (p: RedeemHtlcParams): Promise<RedeemResult> => {
      redeemRecorder.params = p;
      return { proofs: [], amountSats: 200 };
    },
  });

  const provider = createProvider({
    ...validOptions(),
    oracles: [oracleKey.publicKey],
    relayClient,
    cashuClient,
    stateStore,
    selectionTimeoutMs: 200,
    preimageTimeoutMs: 200,
  });
  const servePromise = provider.serve(async () => ({
    amountSats: 200,
    produce: async () => ({ data: { ok: true }, proof: "p1" }),
  }));

  await new Promise((r) => setTimeout(r, 5));
  if (onRequestEvent === null) {
    throw new Error("request subscribe was not called");
  }
  const fireRequest = onRequestEvent as (e: Event) => void;

  // Customer sends a request bound to our (real) oracle.
  const requestEvent = buildQueryRequestEvent(customerKey, {
    query_id: "q-redeem",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: { foo: "bar" },
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: oracleKey.publicKey,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuBinit",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  });
  fireRequest(requestEvent);

  await new Promise((r) => setTimeout(r, 30));
  if (onSelectionEvent === null) {
    throw new Error("selection subscribe was not called");
  }
  (onSelectionEvent as (e: Event) => void)(buildSelectionFeedbackEvent(
    customerKey,
    requestEvent.id,
    {
      status: "processing",
      selected_provider_pubkey: providerKey.publicKey,
      bound_token: "cashuBbound",
    },
  ));

  await new Promise((r) => setTimeout(r, 30));
  if (onPreimageEvent === null) {
    throw new Error("preimage subscribe was not called");
  }
  (onPreimageEvent as (e: Event) => void)(buildPreimageDeliveryEvent(
    oracleKey,
    providerKey.publicKey,
    {
      query_id: "q-redeem",
      request_event_id: requestEvent.id,
      preimage: "ff".repeat(32),
    },
  ));

  await new Promise((r) => setTimeout(r, 30));
  await provider.stop();
  await servePromise;

  expect(redeemRecorder.params).not.toBe(null);
  if (redeemRecorder.params === null) throw new Error("unreachable");
  expect(redeemRecorder.params.token).toBe("cashuBbound");
  expect(redeemRecorder.params.preimageHex).toBe("ff".repeat(32));
  expect(redeemRecorder.params.providerSecretKey).toEqual(
    providerKey.secretKey,
  );

  const stored = await stateStore.get(`provider:${requestEvent.id}`);
  expect(stored).not.toBe(null);
  if (stored === null) throw new Error("provider state was not stored");
  const parsed = JSON.parse(stored) as Record<string, unknown>;
  expect(parsed.status).toBe("redeemed");
  expect(parsed.queryId).toBe("q-redeem");
  expect(parsed.responseEventId).toBe(published[1].id);
});

test("Provider.serve does not publish an offer that exceeds the request's maxAmountSats", async () => {
  const published: Event[] = [];
  let onEventRef: ((e: Event) => void) | null = null;

  const relayClient = makeRelayClient({
    subscribe: (_filter: Filter, onEvent: (e: Event) => void): Subscription => {
      onEventRef = onEvent;
      return { close: () => {} };
    },
    publish: async (event: Event): Promise<PublishResult> => {
      published.push(event);
      return { successes: ["wss://relay.example.org"], failures: [] };
    },
  });

  const provider = createProvider({ ...validOptions(), relayClient });
  const servePromise = provider.serve(async () => ({
    amountSats: 99999, // wildly over-budget
    produce: async () => ({ data: null, proof: "p" }),
  }));

  await new Promise((r) => setTimeout(r, 5));
  if (onEventRef === null) throw new Error("subscribe was not called");
  const onEvent = onEventRef as (e: Event) => void;

  onEvent(buildQueryRequestEvent(customerKey, {
    query_id: "q1",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: {},
    customer_pubkey: customerKey.publicKey,
    oracle_pubkey: ORACLE_A,
    mint_url: "https://mint.example.org",
    bounty_token: "cashuB",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
    expires_at: Date.now() + 60_000,
  }));
  await new Promise((r) => setTimeout(r, 10));
  await provider.stop();
  await servePromise;

  expect(published).toHaveLength(0);
});
