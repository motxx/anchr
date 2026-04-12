import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "./identity.ts";
import {
  buildFrostSignatureDM,
  buildPreimageDM,
  buildRejectionDM,
  parseOracleDM,
  DM_KIND,
} from "./dm.ts";
import type { FrostSignatureDMPayload } from "./events.ts";

describe("FROST DM building and parsing", () => {
  test("buildFrostSignatureDM produces a valid Nostr event (kind 4)", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const event = buildFrostSignatureDM(
      oracle,
      worker.publicKey,
      "query_frost_1",
      "sig_" + "ab".repeat(32),
      "gpk_" + "cd".repeat(16),
    );

    expect(event.kind).toBe(DM_KIND);
    expect(event.pubkey).toBe(oracle.publicKey);
    // Content is encrypted, not plaintext
    expect(event.content).not.toContain("frost_signature");
    expect(event.content).not.toContain("query_frost_1");
    // Has p tag for worker
    const pTag = event.tags.find((t) => t[0] === "p");
    expect(pTag?.[1]).toBe(worker.publicKey);
    // Event has valid signature (finalizeEvent sets sig)
    expect(typeof event.sig).toBe("string");
    expect(event.sig.length).toBeGreaterThan(0);
  });

  test("buildFrostSignatureDM event can be decrypted by recipient with parseOracleDM", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const groupSig = "ab".repeat(32);
    const groupPubkey = "cd".repeat(16);

    const event = buildFrostSignatureDM(
      oracle,
      worker.publicKey,
      "query_frost_2",
      groupSig,
      groupPubkey,
    );

    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey);
    expect(parsed.type).toBe("frost_signature");
  });

  test("parsed payload has type frost_signature with correct fields", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const groupSig = "deadbeef".repeat(8);
    const groupPubkey = "cafebabe".repeat(4);

    const event = buildFrostSignatureDM(
      oracle,
      worker.publicKey,
      "query_frost_3",
      groupSig,
      groupPubkey,
    );

    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey) as FrostSignatureDMPayload;

    expect(parsed.type).toBe("frost_signature");
    expect(parsed.query_id).toBe("query_frost_3");
    expect(parsed.group_signature).toBe(groupSig);
    expect(parsed.group_pubkey).toBe(groupPubkey);
  });

  test("round-trip build/parse preserves query_id, group_signature, group_pubkey", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const queryId = "roundtrip_" + Date.now();
    const groupSig = "ff".repeat(32);
    const groupPubkey = "ee".repeat(16);

    const event = buildFrostSignatureDM(oracle, worker.publicKey, queryId, groupSig, groupPubkey);
    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey) as FrostSignatureDMPayload;

    expect(parsed.query_id).toBe(queryId);
    expect(parsed.group_signature).toBe(groupSig);
    expect(parsed.group_pubkey).toBe(groupPubkey);
  });

  test("parseOracleDM handles preimage type (backward compat)", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();
    const preimage = "abcdef0123456789".repeat(4);

    const event = buildPreimageDM(oracle, worker.publicKey, "query_compat_1", preimage);
    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey);

    expect(parsed.type).toBe("preimage");
    expect(parsed.query_id).toBe("query_compat_1");
    expect((parsed as { preimage: string }).preimage).toBe(preimage);
  });

  test("parseOracleDM handles rejection type (backward compat)", () => {
    const oracle = generateEphemeralIdentity();
    const worker = generateEphemeralIdentity();

    const event = buildRejectionDM(oracle, worker.publicKey, "query_compat_2", "Invalid C2PA");
    const parsed = parseOracleDM(event.content, worker.secretKey, oracle.publicKey);

    expect(parsed.type).toBe("rejection");
    expect(parsed.query_id).toBe("query_compat_2");
    expect((parsed as { reason: string }).reason).toBe("Invalid C2PA");
  });
});
