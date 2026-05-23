import { afterEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createFrostSigner } from "./signer.ts";
import {
  _setFrostSignerPathForTest,
  dkgRound1,
  dkgRound2,
  dkgRound3,
} from "@anchr/sdk/payments";
import type { AttachmentRef } from "../../../../sdk/src/requests/domain/types.ts";
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
  afterEach(() => {
    _setFrostSignerPathForTest(undefined);
  });

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
    _setFrostSignerPathForTest(null);
    const signer = createFrostSigner(signerConfig);

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
  afterEach(() => {
    _setFrostSignerPathForTest(undefined);
  });

  async function generateKeyPackageForSignerOne(): Promise<string> {
    const total = 3;
    const threshold = 2;
    const round1Results: Array<{
      identifier: string;
      secretPackage: string;
      package: string;
    }> = [];

    for (let i = 0; i < total; i++) {
      const result = await dkgRound1(i + 1, total, threshold);
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
      );
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      round2Results.push({
        secretPackage: JSON.stringify(result.data!.secret_package),
        packages: result.data!.packages as Record<string, string>,
      });
    }

    const round2PackagesForSignerOne: Record<string, unknown> = {};
    const round1PackagesForSignerOne: Record<string, unknown> = {};
    for (let j = 1; j < total; j++) {
      round1PackagesForSignerOne[round1Results[j]!.identifier] = JSON.parse(
        round1Results[j]!.package,
      );
      round2PackagesForSignerOne[round1Results[j]!.identifier] =
        (round2Results[j]!.packages as Record<string, unknown>)[
          round1Results[0]!.identifier
        ];
    }

    const result = await dkgRound3(
      round2Results[0]!.secretPackage,
      JSON.stringify(round1PackagesForSignerOne),
      JSON.stringify(round2PackagesForSignerOne),
    );
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    return JSON.stringify(result.data!.key_package);
  }

  test("verifyAndSign round 1 returns nonce_commitment when verification passes", async () => {
    _setFrostSignerPathForTest(realBinary!);

    const signer = createFrostSigner({
      signerIndex: 1,
      keyPackage: await generateKeyPackageForSignerOne(),
    });

    // ai_check is a soft check that passes by default in tests
    const requirement = {
      id: "q-sign-test",
      factors: ["ai_check" as const],
      description: "test query for signing",
    };
    const input = { attachments: [] as AttachmentRef[] };

    const output = await signer.verifyAndSign(
      requirement,
      input,
      "test_message",
    );
    expect(output).not.toBeNull();
    expect(typeof output!.nonce_commitment).toBe("string");
    expect(typeof output!.nonces).toBe("string");
  });
});
