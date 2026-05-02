import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  buildQueryRequestEvent,
  parseQueryRequestEvent,
  type QueryRequestPayload,
} from "./events.ts";
import {
  findAllTagValues,
  findTagValue,
  generateKeypair,
  KIND_QUERY_REQUEST,
} from "./nostr.ts";

function samplePayload(overrides?: Partial<QueryRequestPayload>): QueryRequestPayload {
  return {
    query_id: "query_abc",
    schema: "io.anchr.tlsn-https.v1",
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

test("buildQueryRequestEvent emits the d / t / p / schema tags", () => {
  const identity = generateKeypair();
  const payload = samplePayload();
  const event = buildQueryRequestEvent(identity, payload);

  expect(findTagValue(event, "d")).toBe(payload.query_id);
  expect(findAllTagValues(event, "t")).toContain("anchr");
  expect(findTagValue(event, "p")).toBe(payload.oracle_pubkey);
  expect(findTagValue(event, "schema")).toBe(payload.schema);
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
    content: JSON.stringify({ query_id: "abc", schema: "io.x.y.v1" }),
    tags: [],
  };
  expect(parseQueryRequestEvent(event)).toBe(null);
});
