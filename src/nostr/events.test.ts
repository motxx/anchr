import { test, expect, describe } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  GT_QUERY_REQUEST,
  GT_QUERY_RESPONSE,
  GT_QUERY_SETTLEMENT,
  type QueryRequestPayload,
} from "./events";

describe("Nostr events", () => {
  test("builds and parses QueryRequest event", () => {
    const identity = generateEphemeralIdentity();
    const payload: QueryRequestPayload = {
      type: "photo_proof",
      params: { target: "テヘラン市街の様子" },
      nonce: "K7P4",
      expires_at: Date.now() + 600_000,
    };

    const event = buildQueryRequestEvent(identity, "query_123", payload, "IR");

    expect(event.kind).toBe(GT_QUERY_REQUEST);
    expect(event.pubkey).toBe(identity.publicKey);

    // Check tags
    const dTag = event.tags.find((t) => t[0] === "d");
    expect(dTag?.[1]).toBe("query_123");

    const tTags = event.tags.filter((t) => t[0] === "t");
    expect(tTags.some((t) => t[1] === "ground-truth")).toBe(true);
    expect(tTags.some((t) => t[1] === "photo_proof")).toBe(true);

    const regionTag = event.tags.find((t) => t[0] === "region");
    expect(regionTag?.[1]).toBe("IR");

    // Parse content
    const parsed = parseQueryRequestPayload(event.content);
    expect(parsed.type).toBe("photo_proof");
    expect(parsed.nonce).toBe("K7P4");
    expect(parsed.params.target).toBe("テヘラン市街の様子");
  });

  test("builds and decrypts QueryResponse event", () => {
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
          mime: "image/jpeg",
        }],
      },
    );

    expect(response.kind).toBe(GT_QUERY_RESPONSE);
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

  test("builds and decrypts QuerySettlement event", () => {
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

    expect(settlement.kind).toBe(GT_QUERY_SETTLEMENT);

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
