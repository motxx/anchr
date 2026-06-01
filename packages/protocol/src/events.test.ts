import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  buildOfferFeedbackEvent,
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildSelectionFeedbackEvent,
  parseOfferFeedbackEvent,
  parseOracleQueryResponseEvent,
  parsePreimageDeliveryEvent,
  parseQueryRequestEvent,
  parseQueryResponseEvent,
  parseSelectionFeedbackEvent,
  type QueryRequestPayload,
} from "./events.ts";
import {
  findAllTagValues,
  findTagValue,
  generateKeypair,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
} from "./nostr.ts";

function samplePayload(
  overrides?: Partial<QueryRequestPayload>,
): QueryRequestPayload {
  return {
    query_id: "query_abc",
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    predicate: { target: "https://api.example.org" },
    description: "test",
    customer_pubkey: "11".repeat(32),
    oracle_pubkey: "22".repeat(32),
    mint_url: "https://mint.example.org",
    bounty_token: "cashuBfake",
    max_amount_sats: 1000,
    locktime_seconds: Math.floor(Date.now() / 1000) + 3600,
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
  expect(parsed?.query_id).toBe(payload.query_id);
  expect(parsed?.schema).toBe(payload.schema);
  expect(parsed?.customer_pubkey).toBe(payload.customer_pubkey);
  expect(parsed?.oracle_pubkey).toBe(payload.oracle_pubkey);
  expect(parsed?.bounty_token).toBe(payload.bounty_token);
  expect(parsed?.max_amount_sats).toBe(payload.max_amount_sats);
});

test("buildQueryRequestEvent publishes JSON request content without an encryption marker", () => {
  const identity = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(identity, payload);

  expect(JSON.parse(event.content)).toEqual(payload);
  expect(event.tags.some((tag) => tag[0] === "encrypted")).toBe(false);
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
    status: "payment-required",
    provider_pubkey: provider.publicKey,
    amount_sats: 42,
  });
  expect(parseOfferFeedbackEvent(offer)?.amount_sats).toBe(42);

  const selection = buildSelectionFeedbackEvent(customer, "req123", {
    status: "processing",
    selected_provider_pubkey: provider.publicKey,
    provider_redemption_token: "cashuBbound",
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
  expect(parseSelectionFeedbackEvent(
    selection,
    generateKeypair().secretKey,
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
    query_id: "query_123",
    request_event_id: "req123",
    preimage: "aa".repeat(32),
  });
});
