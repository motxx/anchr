/**
 * E2E tests: FROST 2-of-3 threshold oracle signing.
 *
 * Three signers (Requester Oracle, Worker Oracle, Anchr Official Oracle)
 * run a full FROST DKG + signing lifecycle through the frost-signer CLI.
 *
 * Test matrix:
 *   - DKG: all 3 signers derive the same group pubkey
 *   - Signing 2-of-3: any 2 signers produce a valid BIP-340 Schnorr signature
 *   - Signing 1-of-3: below threshold → aggregation fails
 *   - Verification: correct message → true, wrong message → false
 *   - All 3 pairwise combinations produce valid, distinct signatures
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
  findFrostSigner,
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
// Signer names for clarity
// ---------------------------------------------------------------------------
const SIGNERS = ["Requester", "Worker", "Anchr"] as const;
const THRESHOLD = 2;
const TOTAL = 3;

// ---------------------------------------------------------------------------
// DKG state — populated in beforeAll
// ---------------------------------------------------------------------------
interface SignerDkgState {
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

let signers: SignerDkgState[];
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
// E2E: FROST 2-of-3 threshold oracle
// ---------------------------------------------------------------------------

suite("e2e: FROST 2-of-3 threshold oracle (Requester / Worker / Anchr)", () => {
  // =========================================================================
  // DKG — run once for all tests
  // =========================================================================

  beforeAll(async () => {
    signers = [];

    // --- Round 1: each signer generates their package ---
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
        name: SIGNERS[i]!,
        index: i + 1,
        secretPackage: secretPkg,
        package: pkg,
        identifier,
      });
    }

    // --- Round 2: each signer processes others' round 1 packages ---
    const round2Results: Array<{
      secretPackage: string;
      packages: Record<string, string>;
    }> = [];

    for (let i = 0; i < TOTAL; i++) {
      // Build map of OTHER signers' round1 packages
      const othersMap: Record<string, unknown> = {};
      for (let j = 0; j < TOTAL; j++) {
        if (j === i) continue;
        othersMap[round1Results[j]!.identifier] = JSON.parse(round1Results[j]!.package);
      }

      const r = await dkgRound2(
        round1Results[i]!.secretPackage,
        JSON.stringify(othersMap),
      );
      expect(r.ok).toBe(true);
      expect(r.data).toBeDefined();

      round2Results.push({
        secretPackage: JSON.stringify(r.data!.secret_package),
        packages: r.data!.packages as Record<string, string>,
      });
    }

    // --- Round 3: finalize key generation ---
    for (let i = 0; i < TOTAL; i++) {
      // Collect round2 packages addressed TO signer i from each other signer
      const round2ForMe: Record<string, unknown> = {};
      for (let j = 0; j < TOTAL; j++) {
        if (j === i) continue;
        const pkgsFromJ = round2Results[j]!.packages as Record<string, unknown>;
        const myId = round1Results[i]!.identifier;
        round2ForMe[round1Results[j]!.identifier] = pkgsFromJ[myId];
      }

      // Build round1 others map (same as round 2 input)
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

      signers.push({
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

    // All signers must agree on the group pubkey
    groupPubkey = signers[0]!.groupPubkey;
    pubkeyPackage = signers[0]!.pubkeyPackage;
  });

  // =========================================================================
  // DKG verification
  // =========================================================================

  test("DKG: all 3 signers derive the same group pubkey", () => {
    expect(signers).toHaveLength(3);
    expect(signers[0]!.groupPubkey).toBe(signers[1]!.groupPubkey);
    expect(signers[1]!.groupPubkey).toBe(signers[2]!.groupPubkey);
    expect(groupPubkey).toHaveLength(64); // 32-byte x-only hex
  });

  test("DKG: each signer has a unique key package", () => {
    const kps = signers.map((s) => s.keyPackage);
    expect(new Set(kps).size).toBe(3);
  });

  // =========================================================================
  // 2-of-3 signing — helper
  // =========================================================================

  async function signWithPair(
    signerA: SignerDkgState,
    signerB: SignerDkgState,
    messageHex: string,
  ): Promise<{ signature: string }> {
    // Round 1: generate nonce commitments
    const r1a = await signRound1(signerA.keyPackage);
    expect(r1a.ok).toBe(true);
    const r1b = await signRound1(signerB.keyPackage);
    expect(r1b.ok).toBe(true);

    const noncesA = JSON.stringify(r1a.data!.nonces);
    const noncesB = JSON.stringify(r1b.data!.nonces);
    const commitA = r1a.data!.commitments;
    const commitB = r1b.data!.commitments;

    // Build commitments map
    const commitments: Record<string, unknown> = {};
    commitments[signerA.identifier] = commitA;
    commitments[signerB.identifier] = commitB;
    const commitmentsJson = JSON.stringify(commitments);

    // Round 2: produce signature shares
    const r2a = await signRound2(signerA.keyPackage, noncesA, commitmentsJson, messageHex);
    expect(r2a.ok).toBe(true);
    const r2b = await signRound2(signerB.keyPackage, noncesB, commitmentsJson, messageHex);
    expect(r2b.ok).toBe(true);

    // Aggregate
    const shares: Record<string, unknown> = {};
    shares[signerA.identifier] = r2a.data!.signature_share;
    shares[signerB.identifier] = r2b.data!.signature_share;

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
  // Signing tests
  // =========================================================================

  test("Sign 2-of-3: Requester + Anchr → valid BIP-340 signature", async () => {
    const message = "cafebabe01";
    const { signature } = await signWithPair(signers[0]!, signers[2]!, message);
    expect(signature).toHaveLength(128); // 64-byte Schnorr sig

    const ver = await verifySignature(groupPubkey, signature, message);
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("Sign 2-of-3: Worker + Anchr → valid BIP-340 signature", async () => {
    const message = "deadbeef02";
    const { signature } = await signWithPair(signers[1]!, signers[2]!, message);

    const ver = await verifySignature(groupPubkey, signature, message);
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("Sign 2-of-3: Requester + Worker → valid BIP-340 signature", async () => {
    const message = "aabbccdd03";
    const { signature } = await signWithPair(signers[0]!, signers[1]!, message);

    const ver = await verifySignature(groupPubkey, signature, message);
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });

  test("different signer pairs on same message produce distinct signatures", async () => {
    const message = "11223344";
    const { signature: sig1 } = await signWithPair(signers[0]!, signers[1]!, message);
    const { signature: sig2 } = await signWithPair(signers[0]!, signers[2]!, message);
    const { signature: sig3 } = await signWithPair(signers[1]!, signers[2]!, message);

    // All valid
    for (const sig of [sig1, sig2, sig3]) {
      const ver = await verifySignature(groupPubkey, sig, message);
      expect(ver.data!.valid).toBe(true);
    }

    // All distinct (nonces differ per session)
    expect(new Set([sig1, sig2, sig3]).size).toBe(3);
  });

  // =========================================================================
  // Verification edge cases
  // =========================================================================

  test("wrong message → verification fails", async () => {
    const { signature } = await signWithPair(signers[0]!, signers[1]!, "aabb");

    const ver = await verifySignature(groupPubkey, signature, "ccdd");
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(false);
  });

  test("wrong group pubkey → verification fails", async () => {
    const { signature } = await signWithPair(signers[0]!, signers[1]!, "eeff");
    const fakePubkey = "0000000000000000000000000000000000000000000000000000000000000001";

    const ver = await verifySignature(fakePubkey, signature, "eeff");
    // Either returns valid:false or an error — both acceptable
    if (ver.ok) {
      expect(ver.data!.valid).toBe(false);
    }
  });

  // =========================================================================
  // Below-threshold: 1-of-3 should fail
  // =========================================================================

  test("ATTACK: 1-of-3 (below threshold) → aggregation fails", async () => {
    const signer = signers[0]!;
    const message = "50505050"; // hex

    const r1 = await signRound1(signer.keyPackage);
    expect(r1.ok).toBe(true);

    const commitments: Record<string, unknown> = {};
    commitments[signer.identifier] = r1.data!.commitments;
    const commitmentsJson = JSON.stringify(commitments);

    const nonces = JSON.stringify(r1.data!.nonces);
    const r2 = await signRound2(signer.keyPackage, nonces, commitmentsJson, message);
    // Round 2 may succeed (signing share is produced) — aggregation should fail
    if (!r2.ok) {
      // CLI rejected at round 2 (also acceptable)
      return;
    }

    const shares: Record<string, unknown> = {};
    shares[signer.identifier] = r2.data!.signature_share;

    const agg = await aggregateSignatures(
      groupPubkey,
      commitmentsJson,
      message,
      JSON.stringify(shares),
      pubkeyPackage,
    );

    // Aggregation MUST fail — only 1 share but threshold is 2
    expect(agg.ok).toBe(false);
  });

  // =========================================================================
  // Full 3-of-3 signing (all participate)
  // =========================================================================

  test("Sign 3-of-3: all signers participate → valid signature", async () => {
    const message = "aabbccddee00ff11"; // hex

    // Round 1
    const r1s = await Promise.all(signers.map((s) => signRound1(s.keyPackage)));
    for (const r of r1s) expect(r.ok).toBe(true);

    const commitments: Record<string, unknown> = {};
    for (let i = 0; i < TOTAL; i++) {
      commitments[signers[i]!.identifier] = r1s[i]!.data!.commitments;
    }
    const commitmentsJson = JSON.stringify(commitments);

    // Round 2
    const r2s = await Promise.all(
      signers.map((s, i) =>
        signRound2(s.keyPackage, JSON.stringify(r1s[i]!.data!.nonces), commitmentsJson, message)
      ),
    );
    for (const r of r2s) expect(r.ok).toBe(true);

    const shares: Record<string, unknown> = {};
    for (let i = 0; i < TOTAL; i++) {
      shares[signers[i]!.identifier] = r2s[i]!.data!.signature_share;
    }

    // Aggregate
    const agg = await aggregateSignatures(
      groupPubkey,
      commitmentsJson,
      message,
      JSON.stringify(shares),
      pubkeyPackage,
    );
    expect(agg.ok).toBe(true);

    const sig = agg.data!.signature as string;
    const ver = await verifySignature(groupPubkey, sig, message);
    expect(ver.ok).toBe(true);
    expect(ver.data!.valid).toBe(true);
  });
});
