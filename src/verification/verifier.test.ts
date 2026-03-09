import { expect, test } from "bun:test";
import { verify } from "./verifier";
import type { Query, QueryResult } from "../types";

function makeQuery(overrides: Partial<Query>): Query {
  return {
    id: "query_test",
    type: "photo_proof",
    status: "pending",
    params: { type: "photo_proof", target: "storefront" },
    challenge_nonce: "K7P4",
    challenge_rule: "include nonce",
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    ...overrides,
  };
}

test("photo_proof requires at least one attachment", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    type: "photo_proof",
    text_answer: "Saw the storefront K7P4",
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("at least one photo attachment is required");
});

test("webpage_field requires anchor_word in proof_text", async () => {
  const query = makeQuery({
    type: "webpage_field",
    params: {
      type: "webpage_field",
      url: "https://example.com",
      field: "price",
      anchor_word: "税込",
    },
  });
  const result: QueryResult = {
    type: "webpage_field",
    answer: "¥980",
    proof_text: "some text without the anchor word",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain('anchor word "税込" not found in proof_text');
});

test("webpage_field passes when proof text contains anchor word", async () => {
  const query = makeQuery({
    type: "webpage_field",
    params: {
      type: "webpage_field",
      url: "https://example.com",
      field: "price",
      anchor_word: "税込",
    },
  });
  const result: QueryResult = {
    type: "webpage_field",
    answer: "¥980",
    proof_text: "通常価格 税込 ¥980",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.failures).toHaveLength(0);
});

test("store_status with photo evidence passes", async () => {
  const query = makeQuery({
    type: "store_status",
    params: { type: "store_status", store_name: "Test Ramen" },
  });
  const result: QueryResult = {
    type: "store_status",
    status: "open",
    attachments: [{
      id: "photo1",
      uri: "/uploads/photo1.jpg",
      mime_type: "image/jpeg",
      storage_kind: "local",
    }],
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("photo attachment present");
});

test("store_status without photo evidence passes with weak verification", async () => {
  const query = makeQuery({
    type: "store_status",
    params: { type: "store_status", store_name: "Test Ramen" },
  });
  const result: QueryResult = {
    type: "store_status",
    status: "open",
    notes: "Store looked open",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("no photo evidence provided (weak verification)");
});
