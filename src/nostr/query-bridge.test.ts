import { test, expect, describe } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  type QueryRequestPayload,
} from "./events";

describe("Nostr query bridge - event lifecycle", () => {
  test("full query lifecycle: request → response → settlement", () => {
    // 1. Requester creates query
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const queryPayload: QueryRequestPayload = {
      type: "photo_proof",
      params: {
        type: "photo_proof",
        target: "テヘラン市街の現在の様子",
        region_hint: "IR",
      },
      nonce: "K7P4",
      bounty: {
        mint: "https://mint.example.com",
        token: "cashuAbc...",
      },
      expires_at: Date.now() + 600_000,
    };

    const queryEvent = buildQueryRequestEvent(
      requester,
      "gt_123",
      queryPayload,
      "IR",
    );

    // Verify query event structure
    expect(queryEvent.pubkey).toBe(requester.publicKey);
    const parsed = parseQueryRequestPayload(queryEvent.content);
    expect(parsed.nonce).toBe("K7P4");
    expect(parsed.type).toBe("photo_proof");

    // 2. Worker sees query and responds
    const responseEvent = buildQueryResponseEvent(
      worker,
      queryEvent.id,
      requester.publicKey,
      {
        text_answer: "街は平穏です。特に異常なし。K7P4",
        nonce_echo: "K7P4",
        attachments: [{
          blossom_hash: "sha256:abc123",
          blossom_urls: ["https://blossom.example/abc123"],
          decrypt_key: "deadbeef",
          mime: "image/jpeg",
        }],
      },
    );

    // Requester decrypts response
    const responsePayload = parseQueryResponsePayload(
      responseEvent.content,
      requester.secretKey,
      worker.publicKey,
    );
    expect(responsePayload.nonce_echo).toBe("K7P4");
    expect(responsePayload.text_answer).toContain("K7P4");
    expect(responsePayload.attachments?.length).toBe(1);

    // 3. Requester verifies and settles
    const nonce_ok = responsePayload.nonce_echo === parsed.nonce;
    expect(nonce_ok).toBe(true);

    const settlementEvent = buildQuerySettlementEvent(
      requester,
      queryEvent.id,
      responseEvent.id,
      worker.publicKey,
      {
        status: "accepted",
        cashu_token: "cashuReward...",
      },
    );

    // Worker decrypts settlement
    const settlementPayload = parseQuerySettlementPayload(
      settlementEvent.content,
      worker.secretKey,
      requester.publicKey,
    );
    expect(settlementPayload.status).toBe("accepted");
    expect(settlementPayload.cashu_token).toBe("cashuReward...");
  });

  test("rejected query settlement", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const settlementEvent = buildQuerySettlementEvent(
      requester,
      "query_event_id",
      "response_event_id",
      worker.publicKey,
      {
        status: "rejected",
        reason: "Nonce mismatch",
      },
    );

    const payload = parseQuerySettlementPayload(
      settlementEvent.content,
      worker.secretKey,
      requester.publicKey,
    );
    expect(payload.status).toBe("rejected");
    expect(payload.reason).toBe("Nonce mismatch");
    expect(payload.cashu_token).toBeUndefined();
  });

  test("query with region tag for filtering", () => {
    const identity = generateEphemeralIdentity();

    const event = buildQueryRequestEvent(
      identity,
      "gt_regional",
      {
        type: "photo_proof",
        params: { target: "天安門広場の現在の様子" },
        nonce: "A2B3",
        expires_at: Date.now() + 600_000,
      },
      "CN",
    );

    const regionTag = event.tags.find((t) => t[0] === "region");
    expect(regionTag?.[1]).toBe("CN");

    // Query without region
    const globalEvent = buildQueryRequestEvent(
      identity,
      "gt_global",
      {
        type: "photo_proof",
        params: { target: "何でも" },
        nonce: "X1Y2",
        expires_at: Date.now() + 600_000,
      },
    );
    const noRegionTag = globalEvent.tags.find((t) => t[0] === "region");
    expect(noRegionTag).toBeUndefined();
  });
});
