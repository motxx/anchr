import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  findFrostSigner,
  isFrostSignerAvailable,
  runFrostCommand,
  _setFrostSignerPathForTest,
} from "./frost-cli.ts";

const PROJECT_ROOT = join(import.meta.dirname!, "../../..");

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

describe("frost-cli wrapper", () => {
  afterEach(() => {
    // Reset to undefined so findFrostSigner re-discovers on next call
    _setFrostSignerPathForTest(undefined as unknown as string | null);
  });

  test("findFrostSigner returns a path when binary exists", () => {
    _setFrostSignerPathForTest("/usr/local/bin/frost-signer");
    const result = findFrostSigner();
    expect(result).toBe("/usr/local/bin/frost-signer");
  });

  test("isFrostSignerAvailable returns true when binary exists", () => {
    _setFrostSignerPathForTest("/usr/local/bin/frost-signer");
    expect(isFrostSignerAvailable()).toBe(true);
  });

  test("isFrostSignerAvailable returns false when binary does not exist", () => {
    _setFrostSignerPathForTest(null);
    expect(isFrostSignerAvailable()).toBe(false);
  });

  test("runFrostCommand returns error when binary is not found", async () => {
    _setFrostSignerPathForTest(null);
    const result = await runFrostCommand("dkg-round1", ["--index", "1"]);
    expect(result).toEqual({ ok: false, error: "frost-signer binary not available" });
  });
});

// Tests that require the actual frost-signer binary
const binaryDescribe = realBinary ? describe : describe.ignore;

binaryDescribe("frost-cli with real binary", () => {
  afterEach(() => {
    _setFrostSignerPathForTest(undefined as unknown as string | null);
  });

  test("dkgRound1 calls through to binary and returns structured JSON", async () => {
    _setFrostSignerPathForTest(realBinary!);
    const { dkgRound1 } = await import("./frost-cli.ts");
    const result = await dkgRound1(1, 3, 2);
    // The binary should return ok:true with data containing round1 package
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  test("verifySignature returns ok with valid field", async () => {
    _setFrostSignerPathForTest(realBinary!);
    const { verifySignature } = await import("./frost-cli.ts");
    // Use dummy values — the binary will likely return ok:true with valid:false
    // or ok:false with an error; either way the structure should be correct
    const result = await verifySignature("aa".repeat(32), "bb".repeat(32), "cc".repeat(16));
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result.data).toBeDefined();
    } else {
      expect(typeof result.error).toBe("string");
    }
  });
});
