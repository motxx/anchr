/**
 * E2E tests: FROST t-of-n threshold oracle signing with independent Oracles.
 *
 * Three INDEPENDENT Oracle operators (Anchr, CommunityOracle-A, CommunityOracle-B)
 * run a full FROST DKG + signing lifecycle. Requester and Worker are NOT signers —
 * only neutral verifiers participate in threshold signing.
 *
 * Test matrix:
 *   - DKG: all n signers derive the same group pubkey
 *   - Signing t-of-n: any t signers produce a valid BIP-340 Schnorr signature
 *   - Signing (t-1)-of-n: below threshold → aggregation fails
 *   - Verification: correct message → true, wrong message → false
 *   - All pairwise combinations produce valid, distinct signatures
 *
 * Prerequisites:
 *   cd crates/frost-signer && cargo build --release
 *
 * Run:
 *   deno test e2e/frost-threshold.test.ts --allow-env --allow-read --allow-run --allow-sys
 */

import { describe, test, beforeAll } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  isFrostSignerAvailable,
  dkgRound1,
  dkgRound2,
  dkgRound3,
  signRound1,
  signRound2,
  aggregateSignatures,
  verifySignature,
} from "../src/infrastructure/frost/frost-cli";

// ---------------------------------------------------------------------------
// Oracle operators — all independent, no Requester/Worker
// ---------------------------------------------------------------------------
const ORACLES = ["Anchr", "CommunityOracle-A", "CommunityOracle-B"] as const;
const THRESHOLD = 2;
const TOTAL = 3;

// ---------------------------------------------------------------------------
// DKG state — populated in beforeAll
// ---------------------------------------------------------------------------
interface OracleDkgState {
  name: string;
  index: number;
  identifier: string;
  round1SecretPackage: string;
  round1Package: string;
  round2SecretPackage: string;
  round2Packages: Record<string, string>;
  keyPackage: string;
  pubkeyPackage: string;
  groupPubkey: string;
}

let oracles: OracleDkgState[];
let groupPubkey: string;
let pubkeyPackage: string;

// ---------------------------------------------------------------------------
// Infrastructure readiness
// ---------------------------------------------------------------------------
const FROST_AVAILABLE = isFrostSignerAvailable();
const suite = FROST_AVAILABLE ? describe : describe.ignore;

if (!FROST_AVAILABLE) {
  console.warn("[e2e] frost-signer binary not available — FROST tests will be skipped.");
  console.warn("  Run: cd crates/frost-signer && cargo build --release");
}

// ---------------------------------------------------------------------------
// E2E: FROST t-of-n independent Oracle threshold
// ---------------------------------------------------------------------------

suite("e2e: FROST 2-of-3 independent Oracle threshold (Anchr / CommunityOracle-A / CommunityOracle-B)", () => {
  // =========================================================================
  // DKG — run once for all tests
  // =========================================================================

  beforeAll(async () => {
    oracles = [];

    // --- Round 1 ---
    const round1Results: Array<{
      name: string;
      index: number;
      secretPackage: string;
      package: string;
      identifier: string;
    }> = [];

    for (let i = 0; i < TOTAL; i++) {
      const r = await dkgRound1(i + 1, TOTAL, THRESHOLD);
      expect(r.ok).toBe(true);
      expect(r.data).toBeDefined();

      const secretPkg = JSON.stringify(r.data!.secret_package);
      const pkg = JSON.stringify(r.data!.package);
      const identifier = (r.data!.secret_package as Record<string, unknown>).identifier as string;

      round1Results.push({
        name: ORACLES[i]!,
        index: i + 1,
        secretPackage: secretPkg,
        package: pkg,
        identifier,
      });
    }

    // --- Round 2 ---
    const round2Results: Array<{
      secretPackage: string;
      packages: Record<string, string>;
    }> = [];

    for (let i = 0; i < TOTAL; i++) {
      const othersMap: Record<string, unknown> = {};
      for (let j = 0; j < TOTAL; j++) {
        if (j === i) continue;
        othersMap[round1Results[j]!.identifier] = JSON.parse(round1Results[j]!.package);
      }

      const r = await dkgRound2(round1Results[i]!.secretPackage, JSON.stringify(othersMap));
      expect(r.ok).toBe(true);
      expect(r.data).toBeDefined();

      round2Results.push({
        secretPackage: JSON.stringify(r.data!.secret_package),
        packages: r.data!.packages as Record<string, string>,
      });
    }

    // --- Round 3 ---
    for (let i = 0; i < TOTAL; i++) {
      const round2ForMe: Record<string, unknown> = {};
      for (let j = 0; j < TOTAL; j++) {
        if (j === i) continue;
        const pkgsFromJ = round2Results[j]!.packages as Record<string, unknown>;
        round2ForMe[round1Results[j]!.identifier] = pkgsFromJ[round1Results[i]!.identifier];
      }

      const othersR1Map: Record<string, unknown> = {};
      for (let j = 0; j < TOTAL; j++) {
        if (j === i) continue;
        othersR1Map[round1Results[j]!.identifier] = JSON.parse(round1Results[j]!.package);
      }

      const r = await dkgRound3(
        round2Results[i]!.secretPackage,
        JSON.stringify(othersR1Map),
        JSON.stringify(round2ForMe),
      );
      expect(r.ok).toBe(true);
      expect(r.data).toBeDefined();

      oracles.push({
        name: round1Results[i]!.name,
        index: round1Results[i]!.index,
        identifier: round1Results[i]!.identifier,
        round1SecretPackage: round1Results[i]!.secretPackage,
        round1Package: round1Results[i]!.package,
        round2SecretPackage: round2Results[i]!.secretPackage,
        round2Packages: round2Results[i]!.packages as Record<string, string>,
        keyPackage: JSON.stringify(r.data!.key_package),
        pubkeyPackage: JSON.stringify(r.data!.pubkey_package),
        groupPubkey: r.data!.group_pubkey as string,
      });
    }

    groupPubkey = oracles[0]!.groupPubkey;
    pubkeyPackage = oracles[0]!.pubkeyPackage;
  });

  // =========================================================================
  // DKG verification
  // =========================================================================

  test("DKG: all 3 Oracle operators derive the same group pubkey", () => {
    expect(oracles).toHaveLength(3);
    expect(oracles[0]!.groupPubkey).toBe(oracles[1]!.groupPubkey);
    expect(oracles[1]!.groupPubkey).toBe(oracles[2]!.groupPubkey);
    expect(groupPubkey).toHaveLength(64);
  });

  test("DKG: each Oracle has a unique key package", () => {
    const kps = oracles.map((s) => s.keyPackage);
    expect(new Set(kps).size).toBe(3);
  });

  // =========================================================================
  // t-of-n signing — helper
  // =========================================================================

  async function signWithPair(
    oracleA: OracleDkgState,
    oracleB: OracleDkgState,
    messageHex: string,
  ): Promise<{ signature: string }> {
    const r1a = await signRound1(oracleA.keyPackage);
    expect(r1a.ok).toBe(true);
    const r1b = await signRound1(oracleB.keyPackage);
    expect(r1b.ok).toBe(true);

    const noncesA = JSON.stringify(r1a.data!.nonces);
    const noncesB = JSON.stringify(r1b.data!.nonces);

    const commitments: Record<string, unknown> = {};
    commitments[oracleA.identifier] = r1a.data!.commitments;
    commitments[oracleB.identifier] = r1b.data!.commitments;
    const commitmentsJson = JSON.stringify(commitments);

    const r2a = await signRound2(oracleA.keyPackage, noncesA, commitmentsJson, messageHex);
    expect(r2a.ok).toBe(true);
    const r2b = await signRound2(oracleB.keyPackage, noncesB, commitmentsJson, messageHex);
    expect(r2b.ok).toBe(true);

    const shares: Record<string, unknown> = {};
    shares[oracleA.identifier] = r2a.data!.signature_share;
    shares[oracleB.identifier] = r2b.data!.signature_share;

    const agg = await aggregateSignatures(
      groupPubkey,
      commitmentsJson,
      messageHex,
      JSON.stringify(shares),
      pubkeyPackage,
    );
    expect(agg.ok).toBe(true);
    expect(agg.data!.signature).toBeDefined();

    return { signature: agg.data!.signature as string };
  }

  // =========================================================================
  // Signing tests — all combinations of independent Oracles
  // =========================================================================

  test("Sign 2-of-3: Anchr + CommunityOracle-A → valid BIP-340 signature", async () => {
    const { signature } = await signWithPair(oracles[0]!, oracles[1]!, "cafebabe01");
    expect(signature).toHaveLength(128);

    const ver = await verifySignature(groupPubkey, signature, "cafebabe01");
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("Sign 2-of-3: Anchr + CommunityOracle-B → valid BIP-340 signature", async () => {
    const { signature } = await signWithPair(oracles[0]!, oracles[2]!, "deadbeef02");

    const ver = await verifySignature(groupPubkey, signature, "deadbeef02");
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("Sign 2-of-3: CommunityOracle-A + CommunityOracle-B (no Anchr) → valid", async () => {
    const { signature } = await signWithPair(oracles[1]!, oracles[2]!, "aabbccdd03");

    const ver = await verifySignature(groupPubkey, signature, "aabbccdd03");
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("all Oracle pairs on same message produce distinct, valid signatures", async () => {
    const message = "11223344";
    const { signature: sig1 } = await signWithPair(oracles[0]!, oracles[1]!, message);
    const { signature: sig2 } = await signWithPair(oracles[0]!, oracles[2]!, message);
    const { signature: sig3 } = await signWithPair(oracles[1]!, oracles[2]!, message);

    for (const sig of [sig1, sig2, sig3]) {
      const ver = await verifySignature(groupPubkey, sig, message);
      expect(ver.data!.valid).toBe(true);
    }

    expect(new Set([sig1, sig2, sig3]).size).toBe(3);
  });

  // =========================================================================
  // Verification edge cases
  // =========================================================================

  test("wrong message → verification fails", async () => {
    const { signature } = await signWithPair(oracles[0]!, oracles[1]!, "aabb");
    const ver = await verifySignature(groupPubkey, signature, "ccdd");
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(false);
  });

  test("wrong group pubkey → verification fails", async () => {
    const { signature } = await signWithPair(oracles[0]!, oracles[1]!, "eeff");
    const fakePubkey = "0000000000000000000000000000000000000000000000000000000000000001";
    const ver = await verifySignature(fakePubkey, signature, "eeff");
    if (ver.ok) {
      expect(ver.data!.valid).toBe(false);
    }
  });

  // =========================================================================
  // Below-threshold: 1-of-3 should fail
  // =========================================================================

  test("ATTACK: 1-of-3 (below threshold) → aggregation fails", async () => {
    const oracle = oracles[0]!;
    const message = "50505050";

    const r1 = await signRound1(oracle.keyPackage);
    expect(r1.ok).toBe(true);

    const commitments: Record<string, unknown> = {};
    commitments[oracle.identifier] = r1.data!.commitments;
    const commitmentsJson = JSON.stringify(commitments);

    const nonces = JSON.stringify(r1.data!.nonces);
    const r2 = await signRound2(oracle.keyPackage, nonces, commitmentsJson, message);
    if (!r2.ok) return; // CLI rejected at round 2 (acceptable)

    const shares: Record<string, unknown> = {};
    shares[oracle.identifier] = r2.data!.signature_share;

    const agg = await aggregateSignatures(
      groupPubkey, commitmentsJson, message, JSON.stringify(shares), pubkeyPackage,
    );

    expect(agg.ok).toBe(false);
  });

  // =========================================================================
  // Full n-of-n signing (all participate)
  // =========================================================================

  test("Sign 3-of-3: all Oracle operators participate → valid signature", async () => {
    const message = "aabbccddee00ff11";

    const r1s = await Promise.all(oracles.map((o) => signRound1(o.keyPackage)));
    for (const r of r1s) expect(r.ok).toBe(true);

    const commitments: Record<string, unknown> = {};
    for (let i = 0; i < TOTAL; i++) {
      commitments[oracles[i]!.identifier] = r1s[i]!.data!.commitments;
    }
    const commitmentsJson = JSON.stringify(commitments);

    const r2s = await Promise.all(
      oracles.map((o, i) =>
        signRound2(o.keyPackage, JSON.stringify(r1s[i]!.data!.nonces), commitmentsJson, message)
      ),
    );
    for (const r of r2s) expect(r.ok).toBe(true);

    const shares: Record<string, unknown> = {};
    for (let i = 0; i < TOTAL; i++) {
      shares[oracles[i]!.identifier] = r2s[i]!.data!.signature_share;
    }

    const agg = await aggregateSignatures(
      groupPubkey, commitmentsJson, message, JSON.stringify(shares), pubkeyPackage,
    );
    expect(agg.ok).toBe(true);

    const ver = await verifySignature(groupPubkey, agg.data!.signature as string, message);
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP integration: Oracle server signer endpoints
// ---------------------------------------------------------------------------

suite("e2e: FROST Oracle HTTP signer endpoints (nonce_id + mandatory verification)", () => {
  const API_KEY = "frost-e2e-key";

  test("/frost/signer/round1 rejects missing query+result (400)", async () => {
    const { buildOracleApp } = await import("../src/infrastructure/oracle/oracle-server");
    const app = buildOracleApp({
      oracleId: "test",
      apiKey: API_KEY,
      frostNodeConfig: {
        signer_index: 1,
        total_signers: 3,
        threshold: 2,
        key_package: {},
        pubkey_package: {},
        group_pubkey: "aa".repeat(32),
        peers: [],
      },
    });

    // Missing query and result → must be rejected
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ message: "deadbeef" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing");
  });

  test("/frost/signer/round1 rejects failed verification (403)", async () => {
    const { buildOracleApp } = await import("../src/infrastructure/oracle/oracle-server");
    const app = buildOracleApp({
      oracleId: "test",
      apiKey: API_KEY,
      frostNodeConfig: {
        signer_index: 1,
        total_signers: 3,
        threshold: 2,
        key_package: {},
        pubkey_package: {},
        group_pubkey: "aa".repeat(32),
        peers: [],
      },
    });

    // Provide query+result that will fail verification (no attachments, requires GPS)
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        message: "deadbeef",
        query: {
          id: "q1",
          status: "verifying",
          description: "test",
          verification_requirements: ["gps"],
          created_at: Date.now(),
          expires_at: Date.now() + 60_000,
          payment_status: "locked",
        },
        result: { attachments: [] },
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Verification failed");
  });

  test("/frost/signer/round2 requires nonce_id (400)", async () => {
    const { buildOracleApp } = await import("../src/infrastructure/oracle/oracle-server");
    const app = buildOracleApp({
      oracleId: "test",
      apiKey: API_KEY,
      frostNodeConfig: {
        signer_index: 1,
        total_signers: 3,
        threshold: 2,
        key_package: {},
        pubkey_package: {},
        group_pubkey: "aa".repeat(32),
        peers: [],
      },
    });

    // Missing nonce_id
    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ commitments: "{}", message: "deadbeef" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("nonce_id");
  });

  test("/frost/signer/round2 rejects unknown nonce_id (409)", async () => {
    const { buildOracleApp } = await import("../src/infrastructure/oracle/oracle-server");
    const app = buildOracleApp({
      oracleId: "test",
      apiKey: API_KEY,
      frostNodeConfig: {
        signer_index: 1,
        total_signers: 3,
        threshold: 2,
        key_package: {},
        pubkey_package: {},
        group_pubkey: "aa".repeat(32),
        peers: [],
      },
    });

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ commitments: "{}", message: "deadbeef", nonce_id: "nonexistent-id" }),
    });

    expect(res.status).toBe(409);
  });
});
