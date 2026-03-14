import { test, expect, describe } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import { buildPreimageDM, buildRejectionDM, parseOracleDM, DM_KIND } from "./dm";

describe("NIP-44 DM (Oracle ↔ Worker)", () => {
  test("buildPreimageDM creates kind 4 encrypted DM", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const event = buildPreimageDM(oracle, worker.publicKey, "query_1", "deadbeef".repeat(8));

    expect(event.kind).toBe(DM_KIND);
    expect(event.pubkey).toBe(oracle.publicKey);
    // Content is encrypted, not plaintext
    expect(event.content).not.toContain("preimage");
    // Has p tag for worker
    const pTag = event.tags.find((t) => t[0] === "p");
    expect(pTag?.[1]).toBe(worker.publicKey);
  });

  test("parseOracleDM decrypts preimage DM", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const preimage = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const event = buildPreimageDM(oracle, worker.publicKey, "query_2", preimage);
    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey);

    expect(parsed.type).toBe("preimage");
    expect(parsed.query_id).toBe("query_2");
    expect((parsed as { preimage: string }).preimage).toBe(preimage);
  });

  test("buildRejectionDM creates kind 4 rejection notice", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const event = buildRejectionDM(oracle, worker.publicKey, "query_3", "C2PA signature invalid");

    expect(event.kind).toBe(DM_KIND);
    expect(event.pubkey).toBe(oracle.publicKey);
  });

  test("parseOracleDM decrypts rejection DM", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const event = buildRejectionDM(oracle, worker.publicKey, "query_4", "C2PA signature invalid");
    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey);

    expect(parsed.type).toBe("rejection");
    expect(parsed.query_id).toBe("query_4");
    expect((parsed as { reason: string }).reason).toBe("C2PA signature invalid");
  });

  test("eavesdropper cannot decrypt DM", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const eavesdropper = generateEphemeralIdentity();

    const event = buildPreimageDM(oracle, worker.publicKey, "query_5", "secret_preimage");

    expect(() => {
      parseOracleDM(event.content, eavesdropper.secretKey, oracle.publicKey);
    }).toThrow();
  });
});
