import { test, expect, describe } from "bun:test";
import { isCashuEnabled, getCashuConfig } from "./wallet";

describe("Cashu wallet", () => {
  test("isCashuEnabled returns false when CASHU_MINT_URL is not set", () => {
    const original = process.env.CASHU_MINT_URL;
    delete process.env.CASHU_MINT_URL;

    expect(isCashuEnabled()).toBe(false);
    expect(getCashuConfig()).toBe(null);

    if (original) process.env.CASHU_MINT_URL = original;
  });

  test("getCashuConfig returns config when CASHU_MINT_URL is set", () => {
    const original = process.env.CASHU_MINT_URL;
    process.env.CASHU_MINT_URL = "https://mint.example.com";

    const config = getCashuConfig();
    expect(config).not.toBe(null);
    expect(config!.mintUrl).toBe("https://mint.example.com");
    expect(isCashuEnabled()).toBe(true);

    if (original) {
      process.env.CASHU_MINT_URL = original;
    } else {
      delete process.env.CASHU_MINT_URL;
    }
  });

  test("getCashuConfig trims whitespace", () => {
    const original = process.env.CASHU_MINT_URL;
    process.env.CASHU_MINT_URL = "  https://mint.example.com  ";

    const config = getCashuConfig();
    expect(config!.mintUrl).toBe("https://mint.example.com");

    if (original) {
      process.env.CASHU_MINT_URL = original;
    } else {
      delete process.env.CASHU_MINT_URL;
    }
  });
});
