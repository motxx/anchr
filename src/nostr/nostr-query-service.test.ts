import { expect, test } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
} from "./events";
import {
  buildOracleAttestationEvent,
  parseOracleAttestationPayload,
} from "./oracle-attestation";
import type { OracleAttestation } from "../oracle/types";

// These tests verify the Nostr-native protocol event round-trips
// without requiring relay connectivity.

const requester = generateEphemeralIdentity();
const worker = generateEphemeralIdentity();
const oracle = generateEphemeralIdentity();

test("full protocol lifecycle: request → response → attestation → settlement", () => {
  // 1. Requester creates query request
  const requestPayload: QueryRequestPayload = {
    type: "store_status",
    params: { type: "store_status", store_name: "Ramen Jiro", location_hint: "Shinjuku" },
    nonce: "K7P4",
    oracle_ids: ["built-in"],
    expires_at: Date.now() + 600_000,
  };

  const requestEvent = buildQueryRequestEvent(requester, "gt_test_001", requestPayload, "JP");

  // Verify request event structure
  expect(requestEvent.kind).toBe(30100);
  expect(requestEvent.pubkey).toBe(requester.publicKey);
  const dTag = requestEvent.tags.find((t) => t[0] === "d");
  expect(dTag?.[1]).toBe("gt_test_001");
  const regionTag = requestEvent.tags.find((t) => t[0] === "region");
  expect(regionTag?.[1]).toBe("JP");

  // Parse back
  const parsedRequest = parseQueryRequestPayload(requestEvent.content);
  expect(parsedRequest.type).toBe("store_status");
  expect(parsedRequest.nonce).toBe("K7P4");
  expect(parsedRequest.oracle_ids).toEqual(["built-in"]);

  // 2. Worker responds (NIP-44 encrypted to requester)
  const responsePayload: QueryResponsePayload = {
    text_answer: "営業中です",
    nonce_echo: "K7P4",
    status: "open",
    attachments: [{
      blossom_hash: "abc123",
      blossom_urls: ["https://blossom.example/abc123"],
      decrypt_key: "0123456789abcdef",
      mime: "image/jpeg",
    }],
  };

  const responseEvent = buildQueryResponseEvent(worker, requestEvent.id, requester.publicKey, responsePayload);
  expect(responseEvent.kind).toBe(30101);

  // Requester decrypts response
  const decryptedResponse = parseQueryResponsePayload(
    responseEvent.content,
    requester.secretKey,
    worker.publicKey,
  );
  expect(decryptedResponse.nonce_echo).toBe("K7P4");
  expect(decryptedResponse.status).toBe("open");
  expect(decryptedResponse.attachments?.length).toBe(1);

  // 3. Oracle publishes attestation (plaintext, publicly verifiable)
  const attestation: OracleAttestation = {
    oracle_id: "built-in",
    query_id: "gt_test_001",
    passed: true,
    checks: ["status valid: open", "photo attachment present"],
    failures: [],
    attested_at: Date.now(),
  };

  const attestationEvent = buildOracleAttestationEvent(oracle, requestEvent.id, responseEvent.id, attestation);
  expect(attestationEvent.kind).toBe(30103);

  // Anyone can read attestation
  const parsedAttestation = parseOracleAttestationPayload(attestationEvent.content);
  expect(parsedAttestation.passed).toBe(true);
  expect(parsedAttestation.oracle_id).toBe("built-in");
  expect(parsedAttestation.checks.length).toBe(2);
});

test("nonce mismatch detection", () => {
  const requestPayload: QueryRequestPayload = {
    type: "photo_proof",
    params: { type: "photo_proof", target: "test" },
    nonce: "A2B3",
    expires_at: Date.now() + 60_000,
  };

  const requestEvent = buildQueryRequestEvent(requester, "gt_nonce_test", requestPayload);
  const parsedRequest = parseQueryRequestPayload(requestEvent.content);

  // Worker echoes wrong nonce
  const responsePayload: QueryResponsePayload = {
    text_answer: "here",
    nonce_echo: "WRONG",
  };

  const responseEvent = buildQueryResponseEvent(worker, requestEvent.id, requester.publicKey, responsePayload);
  const decrypted = parseQueryResponsePayload(responseEvent.content, requester.secretKey, worker.publicKey);

  // Requester can detect nonce mismatch
  expect(decrypted.nonce_echo).not.toBe(parsedRequest.nonce);
  expect(decrypted.nonce_echo).toBe("WRONG");
});

test("expired query detection from event tags", () => {
  const past = Date.now() - 60_000;
  const requestPayload: QueryRequestPayload = {
    type: "store_status",
    params: { type: "store_status", store_name: "test" },
    nonce: "X1Y2",
    expires_at: past,
  };

  const event = buildQueryRequestEvent(requester, "gt_expired", requestPayload);
  const expTag = event.tags.find((t) => t[0] === "expiration");
  const expiresUnix = Number(expTag?.[1]);

  // Expired: unix timestamp is in the past
  expect(expiresUnix).toBeLessThan(Date.now() / 1000);
});

test("bounty field preserved in request payload", () => {
  const requestPayload: QueryRequestPayload = {
    type: "photo_proof",
    params: { type: "photo_proof", target: "storefront" },
    nonce: "B4C5",
    bounty: { mint: "https://mint.example", token: "cashuAbc..." },
    expires_at: Date.now() + 600_000,
  };

  const event = buildQueryRequestEvent(requester, "gt_bounty", requestPayload);
  const parsed = parseQueryRequestPayload(event.content);
  expect(parsed.bounty?.mint).toBe("https://mint.example");
  expect(parsed.bounty?.token).toBe("cashuAbc...");
});
