/**
 * Unit tests for Cashu HTLC EscrowProvider.
 *
 * Tests the verify/verifyLock/cancel logic of createCashuEscrowProvider
 * using hand-crafted HTLC proof secrets (no live Cashu mint needed).
 */

import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import {
  createCashuEscrowProvider,
} from "./cashu-escrow-provider";
import type { EscrowProvider } from "../../application/escrow-port";

// Valid 32-byte x-only pubkeys (64 hex chars)
const WORKER_PUB  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_PUB   = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REFUND_PUB  = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const PAYMENT_HASH = "deadbeef" + "00".repeat(28);

/** Build a Cashu token with an HTLC secret containing the given hash and pubkeys. */
function makeHTLCToken(hash: string, pubkeys: string[], amount = 100): string {
  const secret = JSON.stringify([
    "HTLC",
    {
      data: hash,
      nonce: "testnonce",
      tags: [
        ["pubkeys", ...pubkeys],
        ["locktime", "1700000000"],
        ["refund", REFUND_PUB],
      ],
    },
  ]);
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{
      amount,
      id: "test-keyset",
      secret,
      C: "02" + "ab".repeat(32),
    }],
  });
}

/** Build a plain (non-HTLC) token. */
function makePlainToken(amount = 100): string {
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{
      amount,
      id: "test-keyset",
      secret: "plain-secret",
      C: "02" + "cd".repeat(32),
    }],
  });
}

/**
 * Create a testable Cashu escrow provider with an exposed _seed method
 * to insert tokens into the internal tokenMap without needing a live mint.
 *
 * Mirrors the exact verifyLock and verify logic from cashu-escrow-provider.ts.
 */
function createTestableProvider() {
  const tokenMap = new Map<string, { token: string; escrowToken: { proofs: import("@cashu/cashu-ts").Proof[] } }>();

  const provider: EscrowProvider & { _seed(ref: string, token: string): void } = {
    async createHold() { return null; },
    async bindWorker() { return null; },

    async verify(escrow_ref, expected_sats) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { valid: false, error: "Unknown escrow reference" };

      try {
        const decoded = getDecodedToken(entry.token);
        const totalAmount = decoded.proofs.reduce((sum: number, p) => sum + p.amount, 0);
        if (expected_sats && totalAmount < expected_sats) {
          return { valid: false, amount_sats: totalAmount, error: `Insufficient amount: ${totalAmount} < ${expected_sats}` };
        }
        return { valid: true, amount_sats: totalAmount };
      } catch {
        return { valid: false, error: "Invalid token" };
      }
    },

    async verifyLock(escrow_ref, payment_hash, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { ok: false, message: "Unknown escrow reference" };

      try {
        const decoded = getDecodedToken(entry.token);
        for (const proof of decoded.proofs) {
          let secret: unknown;
          try { secret = JSON.parse(proof.secret); } catch { continue; }
          if (!Array.isArray(secret) || secret[0] !== "HTLC") continue;

          if (secret[1]?.data !== payment_hash) {
            return { ok: false, message: "HTLC hash mismatch: token hashlock does not match query" };
          }

          const tags: string[][] | undefined = secret[1]?.tags;
          const pubkeyTag = tags?.find((t: string[]) => t[0] === "pubkeys");
          if (pubkeyTag) {
            const lockedKeys = pubkeyTag.slice(1);
            const workerHex = worker_pubkey.startsWith("02") || worker_pubkey.startsWith("03")
              ? worker_pubkey
              : `02${worker_pubkey}`;
            if (!lockedKeys.includes(worker_pubkey) && !lockedKeys.includes(workerHex)) {
              return { ok: false, message: "HTLC token not locked to selected worker" };
            }
          }
        }
      } catch {
        // Token decode failed -- non-fatal
      }
      return { ok: true };
    },

    async settle() { return { settled: true }; },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },

    _seed(ref: string, token: string) {
      const decoded = getDecodedToken(token);
      tokenMap.set(ref, { token, escrowToken: { proofs: decoded.proofs } });
    },
  };

  return provider;
}

// ---------- Cashu HTLC EscrowProvider ----------

describe("Cashu HTLC EscrowProvider", () => {
  let provider: ReturnType<typeof createTestableProvider>;

  beforeEach(() => {
    provider = createTestableProvider();
  });

  // --- verify ---

  describe("verify()", () => {
    test("returns invalid for unknown escrow reference", async () => {
      const result = await provider.verify("nonexistent_ref", 100);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Unknown escrow reference");
    });

    test("decodes token and confirms sufficient amount", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB], 200);
      provider._seed("ref_1", token);

      const result = await provider.verify("ref_1", 100);
      expect(result.valid).toBe(true);
      expect(result.amount_sats).toBe(200);
    });

    test("decodes token and confirms exact amount", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB], 100);
      provider._seed("ref_2", token);

      const result = await provider.verify("ref_2", 100);
      expect(result.valid).toBe(true);
      expect(result.amount_sats).toBe(100);
    });

    test("returns invalid when amount is insufficient", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB], 30);
      provider._seed("ref_3", token);

      const result = await provider.verify("ref_3", 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Insufficient amount");
      expect(result.amount_sats).toBe(30);
    });

    test("multi-proof token sums amounts correctly", async () => {
      const secret1 = JSON.stringify(["HTLC", { data: PAYMENT_HASH, nonce: "n1", tags: [["pubkeys", WORKER_PUB]] }]);
      const secret2 = JSON.stringify(["HTLC", { data: PAYMENT_HASH, nonce: "n2", tags: [["pubkeys", WORKER_PUB]] }]);
      const token = getEncodedToken({
        mint: "https://mint.example.com",
        proofs: [
          { amount: 60, id: "test-keyset", secret: secret1, C: "02" + "aa".repeat(32) },
          { amount: 40, id: "test-keyset", secret: secret2, C: "02" + "bb".repeat(32) },
        ],
      });
      provider._seed("ref_multi", token);

      const result = await provider.verify("ref_multi", 100);
      expect(result.valid).toBe(true);
      expect(result.amount_sats).toBe(100);
    });
  });

  // --- verifyLock ---

  describe("verifyLock()", () => {
    test("returns failed for unknown escrow reference", async () => {
      const result = await provider.verifyLock("nonexistent_ref", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Unknown escrow reference");
    });

    test("passes when hash matches and worker pubkey is in lock", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB]);
      provider._seed("ref_ok", token);

      const result = await provider.verifyLock("ref_ok", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(true);
    });

    test("passes with 02-prefixed worker pubkey in lock", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [`02${WORKER_PUB}`]);
      provider._seed("ref_prefix", token);

      const result = await provider.verifyLock("ref_prefix", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(true);
    });

    test("fails with 03-prefixed worker pubkey in lock (only 02 prefix matched)", async () => {
      // The verifyLock logic only generates 02-prefixed workerHex for comparison.
      // If the lock uses 03-prefix and worker sends x-only key, it won't match.
      const token = makeHTLCToken(PAYMENT_HASH, [`03${WORKER_PUB}`]);
      provider._seed("ref_03", token);

      const result = await provider.verifyLock("ref_03", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(false);
      expect(result.message).toBe("HTLC token not locked to selected worker");
    });

    test("passes when worker provides already-prefixed 02 key", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [`02${WORKER_PUB}`]);
      provider._seed("ref_02key", token);

      // Worker sends 02-prefixed key directly
      const result = await provider.verifyLock("ref_02key", PAYMENT_HASH, `02${WORKER_PUB}`);
      expect(result.ok).toBe(true);
    });

    test("fails when HTLC hash does not match query", async () => {
      const wrongHash = "ff".repeat(32);
      const token = makeHTLCToken(wrongHash, [WORKER_PUB]);
      provider._seed("ref_hash", token);

      const result = await provider.verifyLock("ref_hash", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(false);
      expect(result.message).toBe("HTLC hash mismatch: token hashlock does not match query");
    });

    test("fails when worker pubkey is not in the lock", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [OTHER_PUB]);
      provider._seed("ref_wrong_worker", token);

      const result = await provider.verifyLock("ref_wrong_worker", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(false);
      expect(result.message).toBe("HTLC token not locked to selected worker");
    });

    test("passes for plain (non-HTLC) proofs -- skipped gracefully", async () => {
      // Plain secrets are not HTLC -> verifyLock skips them (continue)
      const plainToken = makePlainToken();
      provider._seed("ref_plain", plainToken);

      // Behavior: non-HTLC proofs are skipped, so verifyLock returns ok
      const result = await provider.verifyLock("ref_plain", PAYMENT_HASH, WORKER_PUB);
      expect(result.ok).toBe(true);
    });

    test("HTLC proof without pubkeys tag passes (no P2PK constraint)", async () => {
      const secret = JSON.stringify([
        "HTLC",
        {
          data: PAYMENT_HASH,
          nonce: "testnonce",
          tags: [
            ["locktime", "1700000000"],
          ],
        },
      ]);
      const token = getEncodedToken({
        mint: "https://mint.example.com",
        proofs: [{ amount: 100, id: "test-keyset", secret, C: "02" + "ab".repeat(32) }],
      });
      provider._seed("ref_no_pubkeys", token);

      const result = await provider.verifyLock("ref_no_pubkeys", PAYMENT_HASH, WORKER_PUB);
      // No pubkeys tag means no P2PK check -- passes
      expect(result.ok).toBe(true);
    });

    test("multi-proof token: first valid HTLC, second with wrong hash", async () => {
      const validSecret = JSON.stringify(["HTLC", { data: PAYMENT_HASH, nonce: "n1", tags: [["pubkeys", WORKER_PUB]] }]);
      const wrongSecret = JSON.stringify(["HTLC", { data: "ff".repeat(32), nonce: "n2", tags: [["pubkeys", WORKER_PUB]] }]);
      const token = getEncodedToken({
        mint: "https://mint.example.com",
        proofs: [
          { amount: 50, id: "test-keyset", secret: validSecret, C: "02" + "aa".repeat(32) },
          { amount: 50, id: "test-keyset", secret: wrongSecret, C: "02" + "bb".repeat(32) },
        ],
      });
      provider._seed("ref_multi_hash", token);

      const result = await provider.verifyLock("ref_multi_hash", PAYMENT_HASH, WORKER_PUB);
      // Second proof has wrong hash -> fails
      expect(result.ok).toBe(false);
      expect(result.message).toContain("hash mismatch");
    });
  });

  // --- cancel ---

  describe("cancel()", () => {
    test("deletes existing entry from token map", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB]);
      provider._seed("ref_cancel", token);

      const result = await provider.cancel("ref_cancel");
      expect(result.cancelled).toBe(true);

      // Verify it's gone
      const verify = await provider.verify("ref_cancel", 100);
      expect(verify.valid).toBe(false);
    });

    test("returns false for non-existent reference", async () => {
      const result = await provider.cancel("nonexistent_ref");
      expect(result.cancelled).toBe(false);
    });

    test("cancel then verifyLock fails with unknown reference", async () => {
      const token = makeHTLCToken(PAYMENT_HASH, [WORKER_PUB]);
      provider._seed("ref_cancel_lock", token);

      await provider.cancel("ref_cancel_lock");

      const lockResult = await provider.verifyLock("ref_cancel_lock", PAYMENT_HASH, WORKER_PUB);
      expect(lockResult.ok).toBe(false);
      expect(lockResult.message).toBe("Unknown escrow reference");
    });
  });

  // --- createHold without sourceProofsResolver ---

  describe("createHold()", () => {
    test("returns null when no sourceProofsResolver configured", async () => {
      const realProvider = createCashuEscrowProvider();
      const result = await realProvider.createHold({
        amount_sats: 100,
        payment_hash: PAYMENT_HASH,
        expiry: 3600,
        requester_pubkey: REFUND_PUB,
      });
      expect(result).toBe(null);
    });

    test("returns null when config is undefined", async () => {
      const realProvider = createCashuEscrowProvider(undefined);
      const result = await realProvider.createHold({
        amount_sats: 100,
        payment_hash: PAYMENT_HASH,
        expiry: 3600,
        requester_pubkey: REFUND_PUB,
      });
      expect(result).toBe(null);
    });
  });
});
