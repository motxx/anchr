import { test, expect, describe } from "bun:test";
import { generateEphemeralIdentity, restoreIdentity } from "./identity";

describe("Nostr identity", () => {
  test("generates unique ephemeral identities", () => {
    const id1 = generateEphemeralIdentity();
    const id2 = generateEphemeralIdentity();

    expect(id1.publicKey).not.toBe(id2.publicKey);
    expect(id1.secretKeyHex).not.toBe(id2.secretKeyHex);
    expect(id1.publicKey.length).toBe(64); // hex pubkey
    expect(id1.secretKeyHex.length).toBe(64); // hex seckey
  });

  test("restores identity from hex secret key", () => {
    const original = generateEphemeralIdentity();
    const restored = restoreIdentity(original.secretKeyHex);

    expect(restored.publicKey).toBe(original.publicKey);
    expect(restored.secretKeyHex).toBe(original.secretKeyHex);
  });
});
