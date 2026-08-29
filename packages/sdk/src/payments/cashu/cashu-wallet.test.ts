import { getEncodedToken } from "@cashu/cashu-ts";
import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";
import { verifyToken } from "./cashu-wallet.ts";

function makeToken(amount: number): string {
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{
      amount,
      id: "test-keyset",
      secret: "test-secret",
      C: `02${"ab".repeat(32)}`,
    }],
  });
}

describe("verifyToken", () => {
  test("fails closed when no mint is configured", async () => {
    const result = await verifyToken(makeToken(100), 100, { config: {} });

    expect(result).toEqual({
      valid: false,
      amountSats: 100,
      error: "Cashu mint is not configured; proof state cannot be verified",
    });
  });
});
