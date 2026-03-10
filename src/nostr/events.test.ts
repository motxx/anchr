import { test, expect, describe } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  ANCHR_QUERY_SETTLEMENT,
  type QueryRequestPayload,
} from "./events";

describe("Nostr events (NIP-90 DVM)", () => {
  test("builds and parses QueryRequest event with DVM tags", () => {
    const identity = generateEphemeralIdentity();
    const payload: QueryRequestPayload = {
      type: "photo_proof",
      params: { target: "テヘラン市街の様子" },
      nonce: "K7P4",
      expires_at: Date.now() + 600_000,
    };

    const event = buildQueryRequestEvent(identity, "query_123", payload, "IR");

    expect(event.kind).toBe(ANCHR_QUERY_REQUEST);
    expect(event.kind).toBe(5300); // DVM Job Request
    expect(event.pubkey).toBe(identity.publicKey);

    // Check legacy tags
    const dTag = event.tags.find((t) => t[0] === "d");
    expect(dTag?.[1]).toBe("query_123");

    const tTags = event.tags.filter((t) => t[0] === "t");
    expect(tTags.some((t) => t[1] === "anchr")).toBe(true);
    expect(tTags.some((t) => t[1] === "photo_proof")).toBe(true);

    const regionTag = event.tags.find((t) => t[0] === "region");
    expect(regionTag?.[1]).toBe("IR");

    // Check NIP-90 DVM tags
    const iTag = event.tags.find((t) => t[0] === "i");
    expect(iTag?.[1]).toBe("テヘラン市街の様子");
    expect(iTag?.[2]).toBe("text");

    const nonceTag = event.tags.find((t) => t[0] === "param" && t[1] === "nonce");
    expect(nonceTag?.[2]).toBe("K7P4");

    const outputTag = event.tags.find((t) => t[0] === "output");
    expect(outputTag?.[1]).toBe("application/json");

    const encryptedTag = event.tags.find((t) => t[0] === "encrypted");
    expect(encryptedTag).toBeTruthy();

    // No bid tag when no bounty
    const bidTag = event.tags.find((t) => t[0] === "bid");
    expect(bidTag).toBeUndefined();

    // Parse content
    const parsed = parseQueryRequestPayload(event.content);
    expect(parsed.type).toBe("photo_proof");
    expect(parsed.nonce).toBe("K7P4");
    expect(parsed.params.target).toBe("テヘラン市街の様子");
  });

  test("QueryRequest includes bid tag when bounty is present", () => {
    const identity = generateEphemeralIdentity();
    const payload: QueryRequestPayload = {
      type: "photo_proof",
      params: { target: "storefront" },
      nonce: "B1C2",
      bounty: { mint: "https://mint.example", token: "cashuAbc..." },
      expires_at: Date.now() + 600_000,
    };

    const event = buildQueryRequestEvent(identity, "query_bid", payload);

    const bidTag = event.tags.find((t) => t[0] === "bid");
    expect(bidTag?.[1]).toBe("cashuAbc...");
  });

  test("builds and decrypts QueryResponse event (DVM kind 6300)", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_abc",
      requester.publicKey,
      {
        text_answer: "街は平穏です。K7P4",
        nonce_echo: "K7P4",
        attachments: [{
          blossom_hash: "sha256:deadbeef",
          blossom_urls: ["https://blossom.example/deadbeef"],
          decrypt_key: "0123456789abcdef",
          decrypt_iv: "aabbccdd00112233",
          mime: "image/jpeg",
        }],
      },
    );

    expect(response.kind).toBe(ANCHR_QUERY_RESPONSE);
    expect(response.pubkey).toBe(worker.publicKey);

    // Requester can decrypt
    const parsed = parseQueryResponsePayload(
      response.content,
      requester.secretKey,
      worker.publicKey,
    );
    expect(parsed.text_answer).toBe("街は平穏です。K7P4");
    expect(parsed.nonce_echo).toBe("K7P4");
    expect(parsed.attachments?.length).toBe(1);
    expect(parsed.attachments?.[0]?.blossom_hash).toBe("sha256:deadbeef");
  });

  test("builds and decrypts QuerySettlement event (DVM kind 7000)", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const settlement = buildQuerySettlementEvent(
      requester,
      "event_abc",
      "event_xyz",
      worker.publicKey,
      {
        status: "accepted",
        cashu_token: "cashuAbc123...",
      },
    );

    expect(settlement.kind).toBe(ANCHR_QUERY_SETTLEMENT);

    // Check tags
    const eTags = settlement.tags.filter((t) => t[0] === "e");
    expect(eTags.length).toBe(2);
    expect(eTags[0]?.[1]).toBe("event_abc");
    expect(eTags[1]?.[1]).toBe("event_xyz");

    // Worker can decrypt
    const parsed = parseQuerySettlementPayload(
      settlement.content,
      worker.secretKey,
      requester.publicKey,
    );
    expect(parsed.status).toBe("accepted");
    expect(parsed.cashu_token).toBe("cashuAbc123...");
  });

  test("third party cannot decrypt response", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_abc",
      requester.publicKey,
      { text_answer: "secret", nonce_echo: "TEST" },
    );

    // Eavesdropper cannot decrypt
    expect(() =>
      parseQueryResponsePayload(
        response.content,
        eavesdropper.secretKey,
        worker.publicKey,
      ),
    ).toThrow();
  });
});
