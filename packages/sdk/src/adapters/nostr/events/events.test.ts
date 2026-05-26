import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "../crypto/identity.ts";
import {
  ANCHR_QUERY_FEEDBACK,
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  buildOfferFeedbackEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuerySettlementEvent,
  buildSelectionFeedbackEvent,
  type OfferFeedbackPayload,
  parseFeedbackPayload,
  parseOracleResponsePayload,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  parseQuerySettlementPayload,
  type QueryRequestPayload,
  type SelectionFeedbackPayload,
} from "./events.ts";

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

    const nonceTag = event.tags.find((t) =>
      t[0] === "param" && t[1] === "nonce"
    );
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
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      provider,
      "event_abc",
      customer.publicKey,
      {
        nonce_echo: "K7P4",
        attachments: [{
          blossom_hash: "sha256:deadbeef",
          blossom_urls: ["https://blossom.example/deadbeef"],
          decrypt_key_customer: "0123456789abcdef",
          decrypt_iv: "aabbccdd00112233",
          mime: "image/jpeg",
        }],
        notes: "街は平穏です",
      },
    );

    expect(response.kind).toBe(ANCHR_QUERY_RESPONSE);
    expect(response.pubkey).toBe(provider.publicKey);

    // Customer can decrypt
    const parsed = parseQueryResponsePayload(
      response.content,
      customer.secretKey,
      provider.publicKey,
    );
    expect(parsed.nonce_echo).toBe("K7P4");
    expect(parsed.notes).toBe("街は平穏です");
    expect(parsed.attachments?.length).toBe(1);
    expect(parsed.attachments?.[0]?.blossom_hash).toBe("sha256:deadbeef");
  });

  test("builds and decrypts QuerySettlement event (DVM kind 7000)", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const settlement = buildQuerySettlementEvent(
      customer,
      "event_abc",
      "event_xyz",
      provider.publicKey,
      {
        status: "accepted",
        escrow_token: "cashuAbc123...",
      },
    );

    expect(settlement.kind).toBe(ANCHR_QUERY_FEEDBACK);

    // Check tags
    const eTags = settlement.tags.filter((t) => t[0] === "e");
    expect(eTags.length).toBe(2);
    expect(eTags[0]?.[1]).toBe("event_abc");
    expect(eTags[1]?.[1]).toBe("event_xyz");

    // Provider can decrypt
    const parsed = parseQuerySettlementPayload(
      settlement.content,
      provider.secretKey,
      customer.publicKey,
    );
    expect(parsed.status).toBe("accepted");
    expect(parsed.escrow_token).toBe("cashuAbc123...");
  });

  test("QueryResponse includes oracle_payload when oraclePubKey provided", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const oracle = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      provider,
      "event_oracle",
      customer.publicKey,
      {
        nonce_echo: "N1",
        attachments: [{
          blossom_hash: "sha256:aabbccdd",
          blossom_urls: ["https://blossom.example/aabbccdd"],
          decrypt_key_customer: "key_for_customer",
          decrypt_key_oracle: "key_for_oracle",
          decrypt_iv: "iv123",
          mime: "image/jpeg",
        }],
        notes: "oracle test",
      },
      oracle.publicKey,
    );

    // Tags should include oracle pubkey, blob hash, blossom URL, and oracle_payload
    const oracleP = response.tags.find((t) =>
      t[0] === "p" && t[3] === "oracle"
    );
    expect(oracleP?.[1]).toBe(oracle.publicKey);

    const xTag = response.tags.find((t) => t[0] === "x");
    expect(xTag?.[1]).toBe("sha256:aabbccdd");

    const blossomTag = response.tags.find((t) => t[0] === "blossom");
    expect(blossomTag?.[1]).toBe("https://blossom.example/aabbccdd");

    const oraclePayloadTag = response.tags.find((t) =>
      t[0] === "oracle_payload"
    );
    expect(oraclePayloadTag).toBeTruthy();

    // Oracle can decrypt oracle_payload
    const oraclePayload = parseOracleResponsePayload(
      response,
      oracle.secretKey,
    );
    expect(oraclePayload).not.toBeNull();
    expect(oraclePayload!.nonce_echo).toBe("N1");
    expect(oraclePayload!.attachments).toHaveLength(1);
    expect(oraclePayload!.attachments[0]!.decrypt_key_oracle).toBe(
      "key_for_oracle",
    );
    expect(oraclePayload!.attachments[0]!.decrypt_iv).toBe("iv123");
    expect(oraclePayload!.notes).toBe("oracle test");

    // Customer can still decrypt main content
    const customerPayload = parseQueryResponsePayload(
      response.content,
      customer.secretKey,
      provider.publicKey,
    );
    expect(customerPayload.nonce_echo).toBe("N1");
    expect(customerPayload.attachments?.[0]?.decrypt_key_customer).toBe(
      "key_for_customer",
    );
  });

  test("oracle_payload not present when oraclePubKey omitted", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      provider,
      "event_no_oracle",
      customer.publicKey,
      { nonce_echo: "N2" },
    );

    const oraclePayloadTag = response.tags.find((t) =>
      t[0] === "oracle_payload"
    );
    expect(oraclePayloadTag).toBeUndefined();
    expect(parseOracleResponsePayload(response, provider.secretKey)).toBeNull();
  });

  test("eavesdropper cannot decrypt oracle_payload", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const oracle = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      provider,
      "event_eav",
      customer.publicKey,
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

    expect(() => parseOracleResponsePayload(response, eavesdropper.secretKey))
      .toThrow();
  });

  test("builds and decrypts OfferFeedback event (kind 7000)", () => {
    const provider = generateEphemeralIdentity();
    const customer = generateEphemeralIdentity();

    const payload: OfferFeedbackPayload = {
      status: "payment-required",
      provider_pubkey: provider.publicKey,
      amount_sats: 100,
    };

    const event = buildOfferFeedbackEvent(
      provider,
      "event_q1",
      customer.publicKey,
      payload,
    );

    expect(event.kind).toBe(ANCHR_QUERY_FEEDBACK);
    const statusTag = event.tags.find((t) => t[0] === "status");
    expect(statusTag?.[1]).toBe("payment-required");

    // Customer can decrypt
    const parsed = parseFeedbackPayload(
      event.content,
      customer.secretKey,
      provider.publicKey,
    );
    expect(parsed.status).toBe("payment-required");
    expect((parsed as OfferFeedbackPayload).provider_pubkey).toBe(
      provider.publicKey,
    );
    expect((parsed as OfferFeedbackPayload).amount_sats).toBe(100);
  });

  test("builds and decrypts SelectionFeedback event (kind 7000)", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const payload: SelectionFeedbackPayload = {
      status: "processing",
      selected_provider_pubkey: provider.publicKey,
      htlc_token: "cashuToken123",
    };

    const event = buildSelectionFeedbackEvent(
      customer,
      "event_s1",
      provider.publicKey,
      payload,
    );

    expect(event.kind).toBe(ANCHR_QUERY_FEEDBACK);
    const statusTag = event.tags.find((t) => t[0] === "status");
    expect(statusTag?.[1]).toBe("processing");

    // Provider can decrypt
    const parsed = parseFeedbackPayload(
      event.content,
      provider.secretKey,
      customer.publicKey,
    );
    expect(parsed.status).toBe("processing");
    expect((parsed as SelectionFeedbackPayload).selected_provider_pubkey).toBe(
      provider.publicKey,
    );
    expect((parsed as SelectionFeedbackPayload).htlc_token).toBe(
      "cashuToken123",
    );
  });

  test("third party cannot decrypt response", () => {
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const response = buildQueryResponseEvent(
      provider,
      "event_abc",
      customer.publicKey,
      { nonce_echo: "TEST", notes: "secret" },
    );

    // Eavesdropper cannot decrypt
    expect(() =>
      parseQueryResponsePayload(
        response.content,
        eavesdropper.secretKey,
        provider.publicKey,
      )
    ).toThrow();
  });
});
