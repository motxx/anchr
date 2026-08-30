/**
 * Unit tests for tlsn-validation: pure functions and validateTlsn against
 * a mock verifier binary. Integration tests that exercise the end-to-end
 * verifier orchestration flow live in SDK proof verification modules.
 * verifier-tlsn.test.ts (that file imports the host's verifier wrapper
 * which is not part of the package).
 */

import { Buffer } from "node:buffer";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  _clearSeenPresentationsForTest,
  evaluateCondition,
  validateTlsn,
} from "./tlsn-validation.ts";
import type { SidecarExecutor, SpawnResult } from "../internal/runtime/mod.ts";
import type { TlsnAttestation, TlsnRequirement } from "./tlsn-types.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const NOTARY_PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

// --- Helpers ---

function makeAttestation(
  overrides?: Partial<TlsnAttestation>,
): TlsnAttestation {
  return {
    presentation: Buffer.from("fake-presentation").toString("base64"),
    ...overrides,
  };
}

function makeRequirement(
  overrides?: Partial<TlsnRequirement>,
): TlsnRequirement {
  return {
    target_url:
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ...overrides,
  };
}

// --- Mock verifier binary ---

let mockVerifierDir: string;
let mockVerifierPath: string;

function writeMockVerifier(output: Record<string, unknown>) {
  const script = `#!/bin/bash\necho '${JSON.stringify(output)}'`;
  writeFileSync(mockVerifierPath, script, { mode: 0o755 });
}

beforeAll(() => {
  mockVerifierDir = mkdtempSync(join(tmpdir(), "anchr-tlsn-test-"));
  mockVerifierPath = join(mockVerifierDir, "tlsn-verifier");
});

afterAll(() => {
  rmSync(mockVerifierDir, { recursive: true, force: true });
});

// --- Condition evaluation (pure functions, no binary needed) ---

describe("evaluateCondition", () => {
  const body = JSON.stringify({
    bitcoin: { usd: 42000 },
    ethereum: { usd: 3000 },
  });

  test("contains — match", () => {
    const result = evaluateCondition({
      type: "contains",
      expression: "bitcoin",
    }, body);
    expect(result.passed).toBe(true);
  });

  test("contains — no match", () => {
    const result = evaluateCondition({
      type: "contains",
      expression: "dogecoin",
    }, body);
    expect(result.passed).toBe(false);
  });

  test("regex — match", () => {
    const result = evaluateCondition({
      type: "regex",
      expression: '"usd":\\s*\\d+',
    }, body);
    expect(result.passed).toBe(true);
    expect(result.actual_value).toBeTruthy();
  });

  test("regex — no match", () => {
    const result = evaluateCondition({
      type: "regex",
      expression: '"eur":\\s*\\d+',
    }, body);
    expect(result.passed).toBe(false);
  });

  test("jsonpath — exists", () => {
    const result = evaluateCondition({
      type: "jsonpath",
      expression: "bitcoin.usd",
    }, body);
    expect(result.passed).toBe(true);
    expect(result.actual_value).toBe("42000");
  });

  test("jsonpath — not found", () => {
    const result = evaluateCondition({
      type: "jsonpath",
      expression: "bitcoin.eur",
    }, body);
    expect(result.passed).toBe(false);
  });

  test("jsonpath — with expected value match", () => {
    const result = evaluateCondition(
      { type: "jsonpath", expression: "bitcoin.usd", expected: "42000" },
      body,
    );
    expect(result.passed).toBe(true);
  });

  test("jsonpath — with expected value mismatch", () => {
    const result = evaluateCondition(
      { type: "jsonpath", expression: "bitcoin.usd", expected: "99999" },
      body,
    );
    expect(result.passed).toBe(false);
    expect(result.actual_value).toBe("42000");
  });

  test("jsonpath — invalid JSON body", () => {
    const result = evaluateCondition(
      { type: "jsonpath", expression: "foo" },
      "not json",
    );
    expect(result.passed).toBe(false);
    expect(result.actual_value).toBe("invalid JSON");
  });
});

// --- validateTlsn with no binary available ---

describe("validateTlsn without binary", () => {
  test("fails when binary not available", async () => {
    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      verifierPath: null,
    });
    expect(result.available).toBe(false);
    expect(result.failures.some((f) => f.includes("binary not available")))
      .toBe(true);
  });
});

// --- validateTlsn with mock binary ---

describe("validateTlsn with mock binary", () => {
  beforeEach(() => _clearSeenPresentationsForTest());

  test("uses the injected executor for lookup and verifier execution", async () => {
    const commands: Array<{
      command: string[];
      env: Record<string, string> | undefined;
    }> = [];
    const executor: SidecarExecutor = {
      spawn(command, options): SpawnResult {
        commands.push({ command, env: options?.env });
        return {
          exited: Promise.resolve(),
          exitCode: 0,
          stdout: new Blob([
            JSON.stringify({
              valid: true,
              server_name: "api.coingecko.com",
              revealed_body: '{"bitcoin":{"usd":42000}}',
              time: Math.floor(Date.now() / 1000) - 5,
            }),
          ]).stream(),
          stderr: new Blob([""]).stream(),
          kill() {},
        };
      },
      which(name) {
        return name === "tlsn-verifier" ? "/mock/tlsn-verifier" : null;
      },
      isFile() {
        return false;
      },
    };

    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      executor,
      notaryPublicKey: NOTARY_PUBLIC_KEY,
    });

    expect(result.signatureValid).toBe(true);
    expect(result.serverIdentityValid).toBe(true);
    expect(commands[0]?.command.slice(0, 2)).toEqual([
      "/mock/tlsn-verifier",
      "verify",
    ]);
    expect(commands[0]?.env).toEqual({
      ANCHR_TLSN_NOTARY_PUBLIC_KEY_HEX: NOTARY_PUBLIC_KEY,
    });
  });

  test("fails closed when the pinned notary key is not configured", async () => {
    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      verifierPath: mockVerifierPath,
    });
    expect(result.available).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.failures).toContain(
      "TLSNotary: pinned notary public key not configured — cannot verify presentation",
    );
  });

  test("valid presentation passes all checks", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 10,
    });
    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({
        conditions: [{
          type: "jsonpath",
          expression: "bitcoin.usd",
          description: "BTC price",
        }],
      }),
      { verifierPath: mockVerifierPath, notaryPublicKey: NOTARY_PUBLIC_KEY },
    );

    expect(result.signatureValid).toBe(true);
    expect(result.serverIdentityValid).toBe(true);
    expect(result.attestationFresh).toBe(true);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.verifiedData?.server_name).toBe("api.coingecko.com");
    expect(result.verifiedData?.revealed_body).toBe(
      '{"bitcoin":{"usd":42000}}',
    );
  });

  test("invalid signature fails", async () => {
    writeMockVerifier({ valid: false, error: "signature mismatch" });

    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      verifierPath: mockVerifierPath,
      notaryPublicKey: NOTARY_PUBLIC_KEY,
    });
    expect(result.signatureValid).toBe(false);
    expect(result.failures.some((f) => f.includes("signature invalid"))).toBe(
      true,
    );
  });

  test("domain mismatch fails", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "evil.example.com",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000) - 5,
    });
    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      verifierPath: mockVerifierPath,
      notaryPublicKey: NOTARY_PUBLIC_KEY,
    });
    expect(result.serverIdentityValid).toBe(false);
    expect(result.failures.some((f) => f.includes("does not match target")))
      .toBe(true);
  });

  test("stale attestation fails freshness", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000) - 600, // 10 min ago
    });
    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({ max_attestation_age_seconds: 300 }),
      { verifierPath: mockVerifierPath, notaryPublicKey: NOTARY_PUBLIC_KEY },
    );
    expect(result.attestationFresh).toBe(false);
    expect(result.failures.some((f) => f.includes("too old"))).toBe(true);
  });

  test("missing attestation timestamp fails freshness", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: "{}",
    });
    const result = await validateTlsn(makeAttestation(), makeRequirement(), {
      verifierPath: mockVerifierPath,
      notaryPublicKey: NOTARY_PUBLIC_KEY,
    });
    expect(result.attestationFresh).toBe(false);
    expect(result.failures.some((f) => f.includes("no timestamp in proof")))
      .toBe(true);
  });

  test("condition evaluation uses verified body", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 5,
    });
    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({
        conditions: [
          {
            type: "jsonpath",
            expression: "bitcoin.usd",
            description: "BTC price",
          },
          {
            type: "contains",
            expression: "dogecoin",
            description: "DOGE present",
          },
        ],
      }),
      { verifierPath: mockVerifierPath, notaryPublicKey: NOTARY_PUBLIC_KEY },
    );

    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[1]!.passed).toBe(false);
    expect(result.checks.some((c) => c.includes("BTC price"))).toBe(true);
    expect(result.failures.some((f) => f.includes("DOGE present"))).toBe(true);
  });
});
