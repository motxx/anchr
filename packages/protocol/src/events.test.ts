import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  buildHashRequestEvent,
  buildHashResponseEvent,
  buildOfferFeedbackEvent,
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildSelectionFeedbackEvent,
  HASH_REQUEST_VERSION,
  HASH_RESPONSE_VERSION,
  parseHashRequestEvent,
  parseHashResponseEvent,
  parseOfferFeedbackEvent,
  parseOracleQueryResponseEvent,
  parsePreimageDeliveryEvent,
  parseQueryRequestEvent,
  parseQueryResponseEvent,
  parseSelectionFeedbackEvent,
  PREIMAGE_DELIVERY_VERSION,
  QUERY_REQUEST_VERSION,
  QUERY_RESPONSE_VERSION,
  type QueryRequestPayload,
} from "./events.ts";
import {
  decryptNip44,
  encryptNip44,
  findAllTagValues,
  findTagValue,
  generateKeypair,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  signEvent,
} from "./nostr.ts";

function samplePayload(
  overrides?: Partial<Omit<QueryRequestPayload, "version">>,
): Omit<QueryRequestPayload, "version"> {
  return {
    query_id: "query_abc",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    customer_pubkey: "11".repeat(32),
    oracle_pubkey: "22".repeat(32),
    max_amount_sats: 1000,
    expires_at: Date.now() + 600_000,
    ...overrides,
  };
}

test("buildQueryRequestEvent produces a kind 5300 signed event", () => {
  const identity = generateKeypair();
  const event = buildQueryRequestEvent(identity, samplePayload());

  expect(event.kind).toBe(KIND_QUERY_REQUEST);
  expect(event.pubkey).toBe(identity.publicKey);
  expect(event.id).toMatch(/^[0-9a-f]{64}$/);
  expect(event.sig).toMatch(/^[0-9a-f]{128}$/);
});

test("buildQueryRequestEvent emits the d / t / p / s tags", () => {
  const identity = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(identity, payload);

  expect(findTagValue(event, "d")).toBe(payload.query_id);
  expect(findAllTagValues(event, "t")).toContain("anchr");
  expect(findTagValue(event, "p")).toBe(payload.oracle_pubkey);
  expect(findTagValue(event, "s")).toBe(payload.schema);
});

test("parseQueryRequestEvent recovers a payload from the built event (round-trip)", () => {
  const identity = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(identity, payload);
  const parsed = parseQueryRequestEvent(event);

  expect(parsed).not.toBe(null);
  expect(parsed?.version).toBe(QUERY_REQUEST_VERSION);
  expect(parsed?.query_id).toBe(payload.query_id);
  expect(parsed?.schema).toBe(payload.schema);
  expect(parsed?.customer_pubkey).toBe(payload.customer_pubkey);
  expect(parsed?.oracle_pubkey).toBe(payload.oracle_pubkey);
  expect(parsed?.max_amount_sats).toBe(payload.max_amount_sats);
});

test("buildQueryRequestEvent publishes only the Request Notice allowlist", () => {
  const identity = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(identity, payload);
  const content = JSON.parse(event.content);

  expect(content).toEqual({ ...payload, version: 0 });
  expect(Object.keys(content).sort()).toEqual([
    "customer_pubkey",
    "expires_at",
    "max_amount_sats",
    "oracle_pubkey",
    "query_id",
    "schema",
    "version",
  ]);
  expect(content).not.toHaveProperty("predicate");
  expect(content).not.toHaveProperty("context");
  expect(content).not.toHaveProperty("mint_url");
  expect(content).not.toHaveProperty("payment_lock_token");
  expect(content).not.toHaveProperty("provider_redemption_token");
  expect(content).not.toHaveProperty("locktime_seconds");
  expect(event.tags.some((tag) => tag[0] === "encrypted")).toBe(false);
});

test("parseQueryRequestEvent rejects public content carrying execution or payment material", () => {
  const event = {
    kind: KIND_QUERY_REQUEST,
    pubkey: "00".repeat(32),
    id: "00".repeat(32),
    sig: "00".repeat(64),
    created_at: 0,
    content: JSON.stringify({
      ...samplePayload(),
      predicate: { target: "https://api.example.org" },
      mint_url: "https://mint.example.org",
      payment_lock_token: "cashuBfake",
      locktime_seconds: 123,
    }),
    tags: [],
  };
  expect(parseQueryRequestEvent(event)).toBe(null);
});

test("parseQueryRequestEvent rejects each payment-bearing field name on its own", () => {
  for (
    const field of [
      "payment_lock_token",
      "payment_lock",
      "bounty_token",
      "provider_redemption_token",
    ]
  ) {
    const event = {
      kind: KIND_QUERY_REQUEST,
      pubkey: "00".repeat(32),
      id: "00".repeat(32),
      sig: "00".repeat(64),
      created_at: 0,
      content: JSON.stringify({ ...samplePayload(), [field]: "cashuBfake" }),
      tags: [],
    };
    expect(parseQueryRequestEvent(event)).toBe(null);
  }
});

test("parseQueryRequestEvent returns null for a non-kind-5300 event", () => {
  const event = {
    kind: 1,
    pubkey: "00".repeat(32),
    id: "00".repeat(32),
    sig: "00".repeat(64),
    created_at: 0,
    content: JSON.stringify(samplePayload()),
    tags: [],
  };
  expect(parseQueryRequestEvent(event)).toBe(null);
});

test("parseQueryRequestEvent returns null for unparseable content", () => {
  const event = {
    kind: KIND_QUERY_REQUEST,
    pubkey: "00".repeat(32),
    id: "00".repeat(32),
    sig: "00".repeat(64),
    created_at: 0,
    content: "{not json",
    tags: [],
  };
  expect(parseQueryRequestEvent(event)).toBe(null);
});

test("parseQueryRequestEvent returns null when required fields are missing", () => {
  const event = {
    kind: KIND_QUERY_REQUEST,
    pubkey: "00".repeat(32),
    id: "00".repeat(32),
    sig: "00".repeat(64),
    created_at: 0,
    content: JSON.stringify({
      query_id: "abc",
      schema: "https://example.com/spec/proof/custom/v1",
    }),
    tags: [],
  };
  expect(parseQueryRequestEvent(event)).toBe(null);
});

test("buildQueryResponseEvent can include an oracle-readable encrypted payload", () => {
  const provider = generateKeypair();
  const customer = generateKeypair();
  const oracle = generateKeypair();
  const event = buildQueryResponseEvent(
    provider,
    "req123",
    customer.publicKey,
    {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      data: { ok: true },
      proof: "proof-base64",
    },
    oracle.publicKey,
    "query_123",
  );

  expect(event.kind).toBe(KIND_QUERY_RESPONSE);
  expect(findAllTagValues(event, "p")).toContain(customer.publicKey);
  expect(findAllTagValues(event, "p")).toContain(oracle.publicKey);
  expect(findTagValue(event, "oracle_payload")).toBeTruthy();

  const parsed = parseOracleQueryResponseEvent(
    event,
    oracle.secretKey,
    provider.publicKey,
  );
  expect(parsed).not.toBe(null);
  expect(parsed?.version).toBe(QUERY_RESPONSE_VERSION);
  expect(parsed?.query_id).toBe("query_123");
  expect(parsed?.request_event_id).toBe("req123");
  expect(parsed?.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(parsed?.proof).toBe("proof-base64");
  expect(parsed?.data).toEqual({ ok: true });

  const customerParsed = parseQueryResponseEvent(
    event,
    customer.secretKey,
    provider.publicKey,
  );
  expect(customerParsed?.version).toBe(QUERY_RESPONSE_VERSION);
  expect(customerParsed?.schema).toBe(
    "https://anchr-spec.org/spec/proof/tlsn/v1",
  );
  expect(customerParsed?.proof).toBe("proof-base64");
  expect(customerParsed?.data).toEqual({ ok: true });
});

test("feedback events expose causal tags and JSON payloads", () => {
  const provider = generateKeypair();
  const customer = generateKeypair();
  const offer = buildOfferFeedbackEvent(
    provider,
    "req123",
    customer.publicKey,
    {
      status: "payment-required",
      provider_pubkey: provider.publicKey,
      amount_sats: 42,
    },
  );

  expect(offer.kind).toBe(KIND_QUERY_FEEDBACK);
  expect(offer.tags).toContainEqual(["e", "req123", "", "request"]);
  expect(offer.tags).toContainEqual(["p", customer.publicKey]);
  expect(offer.tags).toContainEqual(["status", "payment-required"]);
  expect(JSON.parse(offer.content)).toEqual({
    version: 0,
    status: "payment-required",
    provider_pubkey: provider.publicKey,
    amount_sats: 42,
  });
  expect(parseOfferFeedbackEvent(offer)?.amount_sats).toBe(42);

  const selection = buildSelectionFeedbackEvent(customer, "req123", {
    status: "processing",
    selected_provider_pubkey: provider.publicKey,
    provider_redemption_token: "cashuBbound",
    execution: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: { target: "https://api.example.org" },
      description: "private execution detail",
      mint_url: "https://mint.example.org",
      max_amount_sats: 42,
      amount_sats: 42,
      locktime_seconds: 123456,
    },
  });

  expect(selection.kind).toBe(KIND_QUERY_FEEDBACK);
  expect(selection.tags).toContainEqual(["e", "req123", "", "request"]);
  expect(selection.tags).toContainEqual(["p", provider.publicKey]);
  expect(selection.tags).toContainEqual(["status", "processing"]);
  expect(selection.content.includes("cashuBbound")).toBe(false);

  const parsedSelection = parseSelectionFeedbackEvent(
    selection,
    provider.secretKey,
    customer.publicKey,
  );
  expect(parsedSelection?.provider_redemption_token).toBe("cashuBbound");
  expect(parsedSelection?.execution.amount_sats).toBe(42);
  expect(parsedSelection?.execution.predicate).toEqual({
    target: "https://api.example.org",
  });
  expect(parseSelectionFeedbackEvent(
    selection,
    generateKeypair().secretKey,
    customer.publicKey,
  )).toBe(null);
});

test("parseSelectionFeedbackEvent rejects selection without selected amount", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const payload = {
    status: "processing",
    selected_provider_pubkey: provider.publicKey,
    provider_redemption_token: "cashuBbound",
    execution: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: { target: "https://api.example.org" },
      mint_url: "https://mint.example.org",
      max_amount_sats: 42,
      amount_sats: 42,
      locktime_seconds: 123456,
    },
  };
  const { amount_sats: _amountSats, ...execution } = payload.execution;

  const selection = signEvent(
    {
      kind: KIND_QUERY_FEEDBACK,
      created_at: 123456,
      content: encryptNip44(
        JSON.stringify({ ...payload, execution, version: 0 }),
        customer.secretKey,
        provider.publicKey,
      ),
      tags: [
        ["e", "req123", "", "request"],
        ["p", provider.publicKey],
        ["status", "processing"],
      ],
    },
    customer.secretKey,
  );

  expect(parseSelectionFeedbackEvent(
    selection,
    provider.secretKey,
    customer.publicKey,
  )).toBe(null);
});

test("preimage delivery DMs bind release material to the request event", () => {
  const oracle = generateKeypair();
  const provider = generateKeypair();
  const event = buildPreimageDeliveryEvent(oracle, provider.publicKey, {
    query_id: "query_123",
    request_event_id: "req123",
    preimage: "aa".repeat(32),
  });

  expect(event.tags).toContainEqual(["p", provider.publicKey]);
  const parsed = parsePreimageDeliveryEvent(
    event,
    provider.secretKey,
    oracle.publicKey,
  );
  expect(parsed).toEqual({
    version: PREIMAGE_DELIVERY_VERSION,
    query_id: "query_123",
    request_event_id: "req123",
    preimage: "aa".repeat(32),
  });
});

test("hash bootstrap DM round-trips request and response", () => {
  const customer = generateKeypair();
  const oracle = generateKeypair();

  const request = buildHashRequestEvent(customer, oracle.publicKey, {
    type: "hash_request",
    query_id: "q-bootstrap-1",
  });
  expect(request.kind).toBe(4);
  const parsedRequest = parseHashRequestEvent(
    request,
    oracle.secretKey,
    customer.publicKey,
  );
  expect(parsedRequest).toEqual({
    version: HASH_REQUEST_VERSION,
    type: "hash_request",
    query_id: "q-bootstrap-1",
  });

  const response = buildHashResponseEvent(oracle, customer.publicKey, {
    type: "hash_response",
    query_id: "q-bootstrap-1",
    hash: "ab".repeat(32),
  });
  const parsedResponse = parseHashResponseEvent(
    response,
    customer.secretKey,
    oracle.publicKey,
  );
  expect(parsedResponse).toEqual({
    version: HASH_RESPONSE_VERSION,
    type: "hash_response",
    query_id: "q-bootstrap-1",
    hash: "ab".repeat(32),
  });
});

test("hash bootstrap parsers reject other DM payloads", () => {
  const customer = generateKeypair();
  const oracle = generateKeypair();
  const preimage = buildPreimageDeliveryEvent(oracle, customer.publicKey, {
    query_id: "q1",
    request_event_id: "e1",
    preimage: "cd".repeat(32),
  });
  expect(parseHashRequestEvent(preimage, customer.secretKey, oracle.publicKey))
    .toBe(null);
  expect(parseHashResponseEvent(preimage, customer.secretKey, oracle.publicKey))
    .toBe(null);
  const request = buildHashRequestEvent(customer, oracle.publicKey, {
    type: "hash_request",
    query_id: "q1",
  });
  expect(
    parsePreimageDeliveryEvent(request, oracle.secretKey, customer.publicKey),
  ).toBe(null);
});

test("builders put version 0 in every Anchr JSON object", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();

  const request = buildQueryRequestEvent(customer, samplePayload());
  expect(JSON.parse(request.content).version).toBe(0);

  const offer = buildOfferFeedbackEvent(provider, "req-v", customer.publicKey, {
    status: "payment-required",
    provider_pubkey: provider.publicKey,
    amount_sats: 1,
  });
  expect(JSON.parse(offer.content).version).toBe(0);

  const selection = buildSelectionFeedbackEvent(customer, "req-v", {
    status: "processing",
    selected_provider_pubkey: provider.publicKey,
    provider_redemption_token: "cashuBbound",
    execution: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: {},
      mint_url: "https://mint.example.org",
      max_amount_sats: 1,
      amount_sats: 1,
      locktime_seconds: 123456,
    },
  });
  expect(
    JSON.parse(decryptNip44(
      selection.content,
      provider.secretKey,
      customer.publicKey,
    )).version,
  ).toBe(0);

  const response = buildQueryResponseEvent(
    provider,
    "11".repeat(32),
    customer.publicKey,
    {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      data: {},
      proof: "p",
    },
  );
  expect(
    JSON.parse(decryptNip44(
      response.content,
      customer.secretKey,
      provider.publicKey,
    )).version,
  ).toBe(0);

  const preimage = buildPreimageDeliveryEvent(provider, customer.publicKey, {
    query_id: "query-v",
    request_event_id: "req-v",
    preimage: "aa".repeat(32),
  });
  expect(
    JSON.parse(decryptNip44(
      preimage.content,
      customer.secretKey,
      provider.publicKey,
    )).version,
  ).toBe(0);

  const hashRequest = buildHashRequestEvent(customer, provider.publicKey, {
    type: "hash_request",
    query_id: "query-v",
  });
  expect(
    JSON.parse(decryptNip44(
      hashRequest.content,
      provider.secretKey,
      customer.publicKey,
    )).version,
  ).toBe(0);

  const hashResponse = buildHashResponseEvent(provider, customer.publicKey, {
    type: "hash_response",
    query_id: "query-v",
    hash: "bb".repeat(32),
  });
  expect(
    JSON.parse(decryptNip44(
      hashResponse.content,
      customer.secretKey,
      provider.publicKey,
    )).version,
  ).toBe(0);
});

test("parsers reject a missing, non-integer, or unsupported JSON version", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();

  const request = buildQueryRequestEvent(customer, samplePayload());
  const futureRequest = {
    ...request,
    content: JSON.stringify({ ...JSON.parse(request.content), version: 1 }),
  };
  expect(parseQueryRequestEvent(futureRequest)).toBe(null);
  const stringVersionRequest = {
    ...request,
    content: JSON.stringify({ ...JSON.parse(request.content), version: "0" }),
  };
  expect(parseQueryRequestEvent(stringVersionRequest)).toBe(null);
  const { version: _version, ...contentWithoutVersion } = JSON.parse(
    request.content,
  );
  const unversioned = {
    ...request,
    content: JSON.stringify(contentWithoutVersion),
  };
  expect(parseQueryRequestEvent(unversioned)).toBe(null);

  const offer = buildOfferFeedbackEvent(
    provider,
    "req-v1",
    customer.publicKey,
    {
      status: "payment-required",
      provider_pubkey: provider.publicKey,
      amount_sats: 1,
    },
  );
  const futureOffer = {
    ...offer,
    content: JSON.stringify({ ...JSON.parse(offer.content), version: 2 }),
  };
  expect(parseOfferFeedbackEvent(futureOffer)).toBe(null);
});

test("parseQueryRequestEvent uses the content schema; the s tag is a discovery hint only", () => {
  const customer = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(customer, payload);
  const tampered = {
    ...event,
    tags: event.tags.map((t) =>
      t[0] === "s" ? ["s", "https://evil.example/spec/proof/fake/v1"] : t
    ),
  };

  expect(parseQueryRequestEvent(tampered)?.schema).toBe(payload.schema);
});

test("parseOfferFeedbackEvent binds the offer to its request and customer tags", () => {
  const customer = generateKeypair();
  const provider = generateKeypair();
  const offer = buildOfferFeedbackEvent(
    provider,
    "req-bind",
    customer.publicKey,
    {
      status: "payment-required",
      provider_pubkey: provider.publicKey,
      amount_sats: 7,
    },
  );

  const parsed = parseOfferFeedbackEvent(offer);
  expect(parsed?.request_event_id).toBe("req-bind");
  expect(parsed?.customer_pubkey).toBe(customer.publicKey);

  // An offer stripped of its binding tags cannot be attributed — ignored.
  const unbound = {
    ...offer,
    tags: offer.tags.filter((t) => t[0] !== "e"),
  };
  expect(parseOfferFeedbackEvent(unbound)).toBe(null);
});
