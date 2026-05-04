import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { generateClaimHash } from "./claim-verifier.ts";

test("generateClaimHash returns 32-byte hex preimage and matching SHA-256 hash", () => {
  const { preimage, hash } = generateClaimHash();

  // Preimage must be exactly 64 hex chars (32 bytes).
  expect(preimage).toMatch(/^[0-9a-f]{64}$/);
  // Hash must be exactly 64 hex chars (SHA-256 output).
  expect(hash).toMatch(/^[0-9a-f]{64}$/);

  // The hash MUST equal SHA-256(preimage). This is the load-bearing property
  // for the HTLC: the oracle releases `preimage`, and the Cashu mint
  // verifies that sha256(preimage) == hash before letting the provider
  // spend the locked proofs. A fake hash format (the previous "sha256:..."
  // truncation) would silently break HTLC redemption.
  const expected = bytesToHex(sha256(hexToBytes(preimage)));
  expect(hash).toBe(expected);
});

test("generateClaimHash produces a fresh preimage on each call (CSPRNG, not deterministic)", () => {
  const a = generateClaimHash();
  const b = generateClaimHash();
  expect(a.preimage).not.toBe(b.preimage);
  expect(a.hash).not.toBe(b.hash);
});
