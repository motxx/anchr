import { afterAll, beforeAll, beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import {
  resolveMarket,
  verifyMarketResolution,
  verifyPreimage,
  OracleError,
} from "./market-oracle.ts";
import {
  _setVerifierPathForTest,
  _clearSeenPresentationsForTest,
} from "@anchr/tlsn-toolkit/tlsn-validation";
import type { TwoPartyBinaryBet } from "./market-types.ts";

function makePreimage(): { preimage: string; hash: string } {
  const raw = randomBytes(32);
  return { preimage: bytesToHex(raw), hash: bytesToHex(sha256(raw)) };
}

function makeMarket(overrides: Partial<TwoPartyBinaryBet> = {}): TwoPartyBinaryBet {
  const { preimage, hash } = makePreimage();
  return {
    id: bytesToHex(randomBytes(16)),
    title: "Test market",
    description: "Test",
    category: "crypto",
    creator_pubkey: bytesToHex(randomBytes(32)),
    resolution_url: "https://api.example.com/price",
    resolution_condition: {
      type: "jsonpath_gt",
      target_url: "https://api.example.com/price",
      jsonpath: "price",
      threshold: 100,
      description: "price > 100",
    },
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400,
    yes_pool_sats: 100,
    no_pool_sats: 100,
    min_bet_sats: 1,
    max_bet_sats: 1_000_000,
    fee_ppm: 10_000,
    oracle_pubkey: bytesToHex(randomBytes(32)),
    htlc_hash_yes: hash,
    htlc_hash_no: bytesToHex(sha256(randomBytes(32))),
    nostr_event_id: bytesToHex(randomBytes(32)),
    status: "open",
    ...overrides,
  } as TwoPartyBinaryBet;
}

test("resolveMarket works with htlc_hash_yes", () => {
  const { preimage, hash } = makePreimage();
  const market = makeMarket({ htlc_hash_yes: hash });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 200 });

  const result = resolveMarket(
    market,
    btoa("proof"),
    "api.example.com",
    body,
    now,
    preimage,
  );

  expect(result.outcome).toBe("yes");
  expect(result.preimage).toBe(preimage);
});


test("resolveMarket throws on preimage/hash mismatch", () => {
  const market = makeMarket();
  const wrongPreimage = bytesToHex(randomBytes(32));
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 200 });

  expect(() => {
    resolveMarket(market, btoa("proof"), "api.example.com", body, now, wrongPreimage);
  }).toThrow(OracleError);
});

test("resolveMarket returns NO when condition not met", () => {
  const { preimage, hash } = makePreimage();
  const market = makeMarket({ htlc_hash_yes: hash });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 50 }); // Below threshold of 100

  const result = resolveMarket(
    market,
    btoa("proof"),
    "api.example.com",
    body,
    now,
    preimage,
  );

  expect(result.outcome).toBe("no");
  expect(result.preimage).toBeUndefined();
});

// --- verifyMarketResolution: trustless TLSN-verified resolution path ---

let mockVerifierDir: string;
let mockVerifierPath: string;

function writeMockVerifier(output: Record<string, unknown>) {
  const script = `#!/bin/bash\necho '${JSON.stringify(output)}'`;
  writeFileSync(mockVerifierPath, script, { mode: 0o755 });
}

describe("verifyMarketResolution", () => {
  beforeAll(() => {
    mockVerifierDir = mkdtempSync(join(tmpdir(), "anchr-pm-tlsn-test-"));
    mockVerifierPath = join(mockVerifierDir, "tlsn-verifier");
  });

  afterAll(() => {
    _setVerifierPathForTest(undefined);
    rmSync(mockVerifierDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    _clearSeenPresentationsForTest();
  });

  function freshPresentation(): string {
    return Buffer.from(`presentation-${randomBytes(8).join("")}`).toString("base64");
  }

  test("derives YES outcome when condition met against verified body", async () => {
    const market = makeMarket({
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 100,
        description: "price > 100",
      },
    });
    writeMockVerifier({
      valid: true,
      server_name: "api.example.com",
      revealed_body: JSON.stringify({ price: 200 }),
      time: Math.floor(Date.now() / 1000),
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await verifyMarketResolution(market, freshPresentation());
    expect(result.outcome).toBe("yes");
    expect(result.verifiedServerName).toBe("api.example.com");
    expect(result.verifiedBody).toBe(JSON.stringify({ price: 200 }));
  });

  test("derives NO outcome when condition fails", async () => {
    const market = makeMarket({
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 100,
        description: "price > 100",
      },
    });
    writeMockVerifier({
      valid: true,
      server_name: "api.example.com",
      revealed_body: JSON.stringify({ price: 50 }),
      time: Math.floor(Date.now() / 1000),
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await verifyMarketResolution(market, freshPresentation());
    expect(result.outcome).toBe("no");
  });

  test("rejects an invalid signature", async () => {
    const market = makeMarket({ resolution_url: "https://api.example.com/price" });
    writeMockVerifier({
      valid: false,
      error: "signature mismatch",
    });
    _setVerifierPathForTest(mockVerifierPath);

    await expect(verifyMarketResolution(market, freshPresentation())).rejects.toThrow(/signature invalid/);
  });

  test("rejects when the verified server name doesn't match resolution_url", async () => {
    const market = makeMarket({ resolution_url: "https://api.example.com/price" });
    writeMockVerifier({
      valid: true,
      server_name: "evil.example.net",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000),
    });
    _setVerifierPathForTest(mockVerifierPath);

    await expect(verifyMarketResolution(market, freshPresentation())).rejects.toThrow(/server identity mismatch/);
  });

  test("rejects when the proof is too old", async () => {
    const market = makeMarket({ resolution_url: "https://api.example.com/price" });
    writeMockVerifier({
      valid: true,
      server_name: "api.example.com",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000) - 10_000, // older than the 600s default
    });
    _setVerifierPathForTest(mockVerifierPath);

    await expect(verifyMarketResolution(market, freshPresentation())).rejects.toThrow(/too old/);
  });

  test("throws when the verifier binary isn't available", async () => {
    const market = makeMarket();
    _setVerifierPathForTest(null);
    await expect(verifyMarketResolution(market, freshPresentation())).rejects.toThrow(/verifier binary not available/);
  });
});
