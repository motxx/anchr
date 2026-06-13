import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createFrostSigner } from "./frost-signer.ts";
import { dkgRound1, dkgRound2, dkgRound3, signRound1 } from "./mod.ts";
import type { AttachmentRef } from "../../values.ts";
import { statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname!, "../../../../..");

function findRealBinary(): string | null {
  const candidates = [
    join(PROJECT_ROOT, "crates/frost-signer/target/release/frost-signer"),
    join(PROJECT_ROOT, "crates/frost-signer/target/debug/frost-signer"),
  ];
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p;
    } catch { /* not found */ }
  }
  return null;
}

const realBinary = findRealBinary();

const signerConfig = {
  signerIndex: 1,
  keyPackage: '{"test_key_package":"placeholder"}',
};

// --- Tests that do NOT require the frost-signer binary ---

describe("FrostSigner verification gating", () => {
  test("verifyAndSign returns null when verification fails (no evidence + GPS required)", async () => {
    const signer = createFrostSigner(signerConfig);

    // Empty submission with GPS required — the verifier rejects this
    const requirement = {
      id: "q-no-evidence",
      factors: ["gps" as const],
      expected_gps: { lat: 35.0, lon: 139.0 },
    };
    const input = { attachments: [] as AttachmentRef[] };

    const output = await signer.verifyAndSign(requirement, input, "deadbeef");
    expect(output).toBeNull();
  });

  test("dkgRound returns null when frost-signer is not available", async () => {
    const signer = createFrostSigner({
      ...signerConfig,
      frostSignerPath: null,
    });

    const output = await signer.dkgRound(1, {
      maxSigners: 3,
      minSigners: 2,
    });
    expect(output).toBeNull();
  });

  test("dkgRound 2 returns null when secretPackage is missing", async () => {
    const signer = createFrostSigner(signerConfig);

    // Round 2 requires secretPackage and round1Packages
    const output = await signer.dkgRound(2, {});
    expect(output).toBeNull();
  });

  test("dkgRound 3 returns null when required inputs are missing", async () => {
    const signer = createFrostSigner(signerConfig);

    // Round 3 requires round2SecretPackage, round1Packages, round2Packages
    const output = await signer.dkgRound(3, {});
    expect(output).toBeNull();
  });
});

// --- Tests that require the frost-signer binary ---

const binaryDescribe = realBinary ? describe : describe.ignore;

binaryDescribe("FrostSigner with real binary", () => {
  interface DkgFixture {
    keyPackages: string[];
    identifiers: string[];
  }

  async function generateKeyPackages(): Promise<DkgFixture> {
    const total = 3;
    const threshold = 2;
    const round1Results: Array<{
      identifier: string;
      secretPackage: string;
      package: string;
    }> = [];

    for (let i = 0; i < total; i++) {
      const result = await dkgRound1(i + 1, total, threshold, realBinary!);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      const secretPackage = result.data!.secret_package as Record<
        string,
        unknown
      >;
      round1Results.push({
        identifier: secretPackage.identifier as string,
        secretPackage: JSON.stringify(result.data!.secret_package),
        package: JSON.stringify(result.data!.package),
      });
    }

    const round2Results: Array<{
      secretPackage: string;
      packages: Record<string, string>;
    }> = [];

    for (let i = 0; i < total; i++) {
      const round1PackagesFromOthers: Record<string, unknown> = {};
      for (let j = 0; j < total; j++) {
        if (j !== i) {
          round1PackagesFromOthers[round1Results[j]!.identifier] = JSON.parse(
            round1Results[j]!.package,
          );
        }
      }
      const result = await dkgRound2(
        round1Results[i]!.secretPackage,
        JSON.stringify(round1PackagesFromOthers),
        realBinary!,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      round2Results.push({
        secretPackage: JSON.stringify(result.data!.secret_package),
        packages: result.data!.packages as Record<string, string>,
      });
    }

    const keyPackages: string[] = [];
    for (let i = 0; i < total; i++) {
      const round2PackagesForMe: Record<string, unknown> = {};
      const round1PackagesForMe: Record<string, unknown> = {};
      for (let j = 0; j < total; j++) {
        if (j === i) continue;
        round1PackagesForMe[round1Results[j]!.identifier] = JSON.parse(
          round1Results[j]!.package,
        );
        round2PackagesForMe[round1Results[j]!.identifier] =
          (round2Results[j]!.packages as Record<string, unknown>)[
            round1Results[i]!.identifier
          ];
      }

      const result = await dkgRound3(
        round2Results[i]!.secretPackage,
        JSON.stringify(round1PackagesForMe),
        JSON.stringify(round2PackagesForMe),
        realBinary!,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      keyPackages.push(JSON.stringify(result.data!.key_package));
    }

    return {
      keyPackages,
      identifiers: round1Results.map((r) => r.identifier),
    };
  }

  test("verifyAndSign round 1 returns nonce_commitment and a session id", async () => {
    const { keyPackages } = await generateKeyPackages();
    const signer = createFrostSigner({
      signerIndex: 1,
      keyPackage: keyPackages[0]!,
      frostSignerPath: realBinary!,
    });

    const requirement = {
      id: "q-sign-test",
      factors: ["nonce" as const],
      description: "test query for signing",
    };
    const input = {
      attachments: [{
        id: "proof-q-sign-test",
        uri: "https://blossom.example.com/proof-q-sign-test.txt",
        mime_type: "text/plain",
        storage_kind: "blossom",
        blossom_hash: "proof-q-sign-test",
      }] as AttachmentRef[],
    };

    const output = await signer.verifyAndSign(
      requirement,
      input,
      "test_message",
    );
    expect(output).not.toBeNull();
    expect(typeof output!.nonce_commitment).toBe("string");
    expect(typeof output!.session_id).toBe("string");
  });

  test("two interleaved sessions keep their own nonces and consume once", async () => {
    const { keyPackages, identifiers } = await generateKeyPackages();
    const signer = createFrostSigner({
      signerIndex: 1,
      keyPackage: keyPackages[0]!,
      frostSignerPath: realBinary!,
    });

    const requirement = {
      id: "q-interleave",
      factors: ["nonce" as const],
      description: "interleaved sessions",
    };
    const input = {
      attachments: [{
        id: "proof-q-interleave",
        uri: "https://blossom.example.com/proof-q-interleave.txt",
        mime_type: "text/plain",
        storage_kind: "blossom",
        blossom_hash: "proof-q-interleave",
      }] as AttachmentRef[],
    };

    const r1a = await signer.verifyAndSign(requirement, input, "aaaa01");
    const r1b = await signer.verifyAndSign(requirement, input, "bbbb02");
    expect(r1a?.session_id).toBeDefined();
    expect(r1b?.session_id).toBeDefined();
    expect(r1a!.session_id).not.toBe(r1b!.session_id);

    // Signer 2 contributes real commitments so round 2 reaches threshold.
    const s2a = await signRound1(keyPackages[1]!, realBinary!);
    const s2b = await signRound1(keyPackages[1]!, realBinary!);
    expect(s2a.ok && s2b.ok).toBe(true);

    const commitmentsA = JSON.stringify({
      [identifiers[0]!]: JSON.parse(r1a!.nonce_commitment!),
      [identifiers[1]!]: s2a.data!.commitments,
    });
    const commitmentsB = JSON.stringify({
      [identifiers[0]!]: JSON.parse(r1b!.nonce_commitment!),
      [identifiers[1]!]: s2b.data!.commitments,
    });

    // Round 2 must use each session's own message; a crossed message is
    // refused before any signing happens.
    const crossed = await signer.verifyAndSign(
      requirement,
      input,
      "bbbb02",
      commitmentsA,
      undefined,
      r1a!.session_id,
    );
    expect(crossed).toBeNull();

    // Session B (untouched by the crossed attempt against A) still signs.
    const r2b = await signer.verifyAndSign(
      requirement,
      input,
      "bbbb02",
      commitmentsB,
      undefined,
      r1b!.session_id,
    );
    expect(r2b?.signature_share).toBeDefined();

    // Session A was consumed by the rejected attempt — replay is refused.
    const replayA = await signer.verifyAndSign(
      requirement,
      input,
      "aaaa01",
      commitmentsA,
      undefined,
      r1a!.session_id,
    );
    expect(replayA).toBeNull();

    // Round 2 with no session id is refused outright.
    const noSession = await signer.verifyAndSign(
      requirement,
      input,
      "aaaa01",
      commitmentsA,
    );
    expect(noSession).toBeNull();
  });
});
