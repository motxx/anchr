import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { isCashuEnabled, getCashuConfig, createBountyToken } from "./wallet.ts";

describe("Cashu wallet", () => {
  test("isCashuEnabled returns false when CASHU_MINT_URL is not set", () => {
    const original = Deno.env.get("CASHU_MINT_URL");
    Deno.env.delete("CASHU_MINT_URL");

    expect(isCashuEnabled()).toBe(false);
    expect(getCashuConfig()).toBe(null);

    if (original) Deno.env.set("CASHU_MINT_URL", original);
  });

  test("getCashuConfig returns config when CASHU_MINT_URL is set", () => {
    const original = Deno.env.get("CASHU_MINT_URL");
    Deno.env.set("CASHU_MINT_URL", "https://mint.example.com");

    const config = getCashuConfig();
    expect(config).not.toBe(null);
    expect(config!.mintUrl).toBe("https://mint.example.com");
    expect(isCashuEnabled()).toBe(true);

    if (original) {
      Deno.env.set("CASHU_MINT_URL", original);
    } else {
      Deno.env.delete("CASHU_MINT_URL");
    }
  });

  test("getCashuConfig trims whitespace", () => {
    const original = Deno.env.get("CASHU_MINT_URL");
    Deno.env.set("CASHU_MINT_URL", "  https://mint.example.com  ");

    const config = getCashuConfig();
    expect(config!.mintUrl).toBe("https://mint.example.com");

    if (original) {
      Deno.env.set("CASHU_MINT_URL", original);
    } else {
      Deno.env.delete("CASHU_MINT_URL");
    }
  });

  test("createBountyToken returns null when CASHU_MINT_URL is unset (no implicit demo path)", async () => {
    // When CASHU_MINT_URL is unset, createBountyToken must bail cleanly —
    // calling wallet.mintProofs() immediately after createMintQuote() races
    // against any externally-paid Lightning invoice and silently fails in
    // production. The function must return null in this case (no throw, no hang).
    const original = Deno.env.get("CASHU_MINT_URL");
    Deno.env.delete("CASHU_MINT_URL");
    try {
      const result = await createBountyToken(21);
      expect(result).toBeNull();
    } finally {
      if (original) Deno.env.set("CASHU_MINT_URL", original);
    }
  });
});
