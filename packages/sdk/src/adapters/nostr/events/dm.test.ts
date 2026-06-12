import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "../../../identity.ts";
import { KIND_DIRECT_MESSAGE } from "@anchr/protocol/nostr";
import { buildPreimageDM, buildRejectionDM, parseOracleDM } from "./dm.ts";
import { deriveConversationKey, encryptNip44 } from "../crypto/encryption.ts";

describe("NIP-44 DM (Oracle ↔ Provider)", () => {
  test("buildPreimageDM creates kind 4 encrypted DM", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const event = buildPreimageDM(
      oracle,
      provider.publicKey,
      "query_1",
      "deadbeef".repeat(8),
    );

    expect(event.kind).toBe(KIND_DIRECT_MESSAGE);
    expect(event.pubkey).toBe(oracle.publicKey);
    expect(event.content).not.toContain("preimage");
    const pTag = event.tags.find((t) => t[0] === "p");
    expect(pTag?.[1]).toBe(provider.publicKey);
  });

  test("parseOracleDM decrypts preimage DM", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const preimage =
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const event = buildPreimageDM(
      oracle,
      provider.publicKey,
      "query_2",
      preimage,
    );
    const parsed = parseOracleDM(
      event.content,
      provider.secretKey,
      oracle.publicKey,
    );

    expect(parsed?.type).toBe("preimage");
    if (parsed?.type !== "preimage") throw new Error("unreachable");
    expect(parsed.query_id).toBe("query_2");
    expect(parsed.preimage).toBe(preimage);
  });

  test("buildRejectionDM creates kind 4 rejection notice", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const event = buildRejectionDM(
      oracle,
      provider.publicKey,
      "query_3",
      "C2PA signature invalid",
    );

    expect(event.kind).toBe(KIND_DIRECT_MESSAGE);
    expect(event.pubkey).toBe(oracle.publicKey);
  });

  test("parseOracleDM decrypts rejection DM", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    const event = buildRejectionDM(
      oracle,
      provider.publicKey,
      "query_4",
      "C2PA signature invalid",
    );
    const parsed = parseOracleDM(
      event.content,
      provider.secretKey,
      oracle.publicKey,
    );

    expect(parsed?.type).toBe("rejection");
    if (parsed?.type !== "rejection") throw new Error("unreachable");
    expect(parsed.query_id).toBe("query_4");
    expect(parsed.reason).toBe("C2PA signature invalid");
  });

  test("eavesdropper cannot decrypt DM", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const event = buildPreimageDM(
      oracle,
      provider.publicKey,
      "query_5",
      "secret_preimage",
    );

    expect(
      parseOracleDM(event.content, eavesdropper.secretKey, oracle.publicKey),
    ).toBeNull();
  });

  test("parseOracleDM rejects a decrypted payload with an unknown shape", () => {
    const oracle = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();

    // Encrypt a syntactically valid JSON body that is not a release payload.
    const event = buildRejectionDM(
      oracle,
      provider.publicKey,
      "query_6",
      "placeholder",
    );
    const tampered = encryptNip44(
      JSON.stringify({ type: "preimage", query_id: "query_6" }),
      deriveConversationKey(oracle.secretKey, provider.publicKey),
    );
    expect(
      parseOracleDM(tampered, provider.secretKey, oracle.publicKey),
    ).toBeNull();
    // The well-formed event still parses.
    expect(
      parseOracleDM(event.content, provider.secretKey, oracle.publicKey)
        ?.type,
    ).toBe("rejection");
  });
});
