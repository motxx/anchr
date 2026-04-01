import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  parseOracleResponsePayload,
  parseFeedbackPayload,
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  ANCHR_QUERY_FEEDBACK,
  ANCHR_QUERY_SETTLEMENT,
  type QueryRequestPayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
} from "./events";

describe("Nostr events (NIP-90 DVM)", () => {
  test("builds and parses QueryRequest event with DVM tags", () => {
    const identity = generateEphemeralIdentity();
    const payload: QueryRequestPayload = {
      description: "テヘラン市街の様子",
      nonce: "K7P4",
      expires_at: Date.now() + 600_000,
    };

    const event = buildQueryRequestEvent(identity, "query_123", payload, "IR");

    expect(event.kind).toBe(ANCHR_QUERY_REQUEST);
    expect(event.kind).toBe(5300); // DVM Job Request
    expect(event.pubkey).toBe(identity.publicKey);

    // Check tags
    const dTag = event.tags.find((t) => t[0] === "d");
    expect(dTag?.[1]).toBe("query_123");

    const tTags = event.tags.filter((t) => t[0] === "t");
    expect(tTags.some((t) => t[1] === "anchr")).toBe(true);

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
    expect(parsed.description).toBe("テヘラン市街の様子");
    expect(parsed.nonce).toBe("K7P4");
  });

  test("QueryRequest includes bid tag when bounty is present", () => {
    const identity = generateEphemeralIdentity();
    const payload: QueryRequestPayload = {
      description: "storefront observation",
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
        nonce_echo: "K7P4",
        attachments: [{
          blossom_hash: "sha256:deadbeef",
          blossom_urls: ["https://blossom.example/deadbeef"],
          decrypt_key: "0123456789abcdef",
          decrypt_iv: "aabbccdd00112233",
          mime: "image/jpeg",
        }],
        notes: "街は平穏です",
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
    expect(parsed.nonce_echo).toBe("K7P4");
    expect(parsed.notes).toBe("街は平穏です");
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

  test("QueryResponse includes oracle_payload when oraclePubKey provided", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const oracle = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_oracle",
      requester.publicKey,
      {
        nonce_echo: "N1",
        attachments: [{
          blossom_hash: "sha256:aabbccdd",
          blossom_urls: ["https://blossom.example/aabbccdd"],
          decrypt_key_requester: "key_for_requester",
          decrypt_key_oracle: "key_for_oracle",
          decrypt_iv: "iv123",
          mime: "image/jpeg",
        }],
        notes: "oracle test",
      },
      oracle.publicKey,
    );

    // Tags should include oracle pubkey, blob hash, blossom URL, and oracle_payload
    const oracleP = response.tags.find((t) => t[0] === "p" && t[3] === "oracle");
    expect(oracleP?.[1]).toBe(oracle.publicKey);

    const xTag = response.tags.find((t) => t[0] === "x");
    expect(xTag?.[1]).toBe("sha256:aabbccdd");

    const blossomTag = response.tags.find((t) => t[0] === "blossom");
    expect(blossomTag?.[1]).toBe("https://blossom.example/aabbccdd");

    const oraclePayloadTag = response.tags.find((t) => t[0] === "oracle_payload");
    expect(oraclePayloadTag).toBeTruthy();

    // Oracle can decrypt oracle_payload
    const oraclePayload = parseOracleResponsePayload(response, oracle.secretKey);
    expect(oraclePayload).not.toBeNull();
    expect(oraclePayload!.nonce_echo).toBe("N1");
    expect(oraclePayload!.attachments).toHaveLength(1);
    expect(oraclePayload!.attachments[0]!.decrypt_key_oracle).toBe("key_for_oracle");
    expect(oraclePayload!.attachments[0]!.decrypt_iv).toBe("iv123");
    expect(oraclePayload!.notes).toBe("oracle test");

    // Requester can still decrypt main content
    const requesterPayload = parseQueryResponsePayload(
      response.content,
      requester.secretKey,
      worker.publicKey,
    );
    expect(requesterPayload.nonce_echo).toBe("N1");
    expect(requesterPayload.attachments?.[0]?.decrypt_key_requester).toBe("key_for_requester");
  });

  test("oracle_payload not present when oraclePubKey omitted", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_no_oracle",
      requester.publicKey,
      { nonce_echo: "N2" },
    );

    const oraclePayloadTag = response.tags.find((t) => t[0] === "oracle_payload");
    expect(oraclePayloadTag).toBeUndefined();
    expect(parseOracleResponsePayload(response, worker.secretKey)).toBeNull();
  });

  test("eavesdropper cannot decrypt oracle_payload", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const oracle = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_eav",
      requester.publicKey,
      {
        nonce_echo: "N3",
        attachments: [{
          blossom_hash: "sha256:1234",
          blossom_urls: ["https://blossom.example/1234"],
          decrypt_key_oracle: "secret_key",
          decrypt_iv: "iv456",
          mime: "image/png",
        }],
      },
      oracle.publicKey,
    );

    expect(() => parseOracleResponsePayload(response, eavesdropper.secretKey)).toThrow();
  });

  test("builds and decrypts QuoteFeedback event (kind 7000)", () => {
    const worker = generateEphemeralIdentity();
    const requester = generateEphemeralIdentity();

    const payload: QuoteFeedbackPayload = {
      status: "payment-required",
      worker_pubkey: worker.publicKey,
      amount_sats: 100,
    };

    const event = buildQuoteFeedbackEvent(worker, "event_q1", requester.publicKey, payload);

    expect(event.kind).toBe(ANCHR_QUERY_FEEDBACK);
    const statusTag = event.tags.find((t) => t[0] === "status");
    expect(statusTag?.[1]).toBe("payment-required");

    // Requester can decrypt
    const parsed = parseFeedbackPayload(event.content, requester.secretKey, worker.publicKey);
    expect(parsed.status).toBe("payment-required");
    expect((parsed as QuoteFeedbackPayload).worker_pubkey).toBe(worker.publicKey);
    expect((parsed as QuoteFeedbackPayload).amount_sats).toBe(100);
  });

  test("builds and decrypts SelectionFeedback event (kind 7000)", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const payload: SelectionFeedbackPayload = {
      status: "processing",
      selected_worker_pubkey: worker.publicKey,
      htlc_token: "cashuToken123",
    };

    const event = buildSelectionFeedbackEvent(requester, "event_s1", worker.publicKey, payload);

    expect(event.kind).toBe(ANCHR_QUERY_FEEDBACK);
    const statusTag = event.tags.find((t) => t[0] === "status");
    expect(statusTag?.[1]).toBe("processing");

    // Worker can decrypt
    const parsed = parseFeedbackPayload(event.content, worker.secretKey, requester.publicKey);
    expect(parsed.status).toBe("processing");
    expect((parsed as SelectionFeedbackPayload).selected_worker_pubkey).toBe(worker.publicKey);
    expect((parsed as SelectionFeedbackPayload).htlc_token).toBe("cashuToken123");
  });

  test("third party cannot decrypt response", () => {
    const requester = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      worker,
      "event_abc",
      requester.publicKey,
      { nonce_echo: "TEST", notes: "secret" },
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
