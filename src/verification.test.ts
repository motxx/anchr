import { expect, test } from "bun:test";
import { verify } from "./verification";
import type { Query, QueryResult } from "./types";

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

test("photo_proof requires at least one attachment", () => {
  const query = makeQuery({});
  const result: QueryResult = {
    type: "photo_proof",
    text_answer: "Saw the storefront K7P4",
    attachments: [],
    notes: "",
  };

  const verification = verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("at least one photo attachment is required");
});

test("webpage_field requires nonce in notes", () => {
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
    notes: "checked page",
  };

  const verification = verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain('nonce "K7P4" not found in notes');
});

test("webpage_field passes when proof text and nonce are present", () => {
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
    notes: "checked page K7P4",
  };

  const verification = verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.failures).toHaveLength(0);
});
