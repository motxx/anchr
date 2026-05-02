import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  CashuClientError,
  CashuMintError,
  createCashuClient,
  validateHashHex,
  validateLocktime,
} from "./cashu.ts";

const VALID_HASH = "deadbeef".repeat(8); // 64-char hex

test("createCashuClient stores the mint URL on the returned client", () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  expect(client.mintUrl).toBe("https://mint.example.org");
});

test("createCashuClient rejects an empty mint URL", () => {
  expect(() => createCashuClient({ mintUrl: "" })).toThrow(CashuClientError);
});

test("createCashuClient.buildHtlcLock throws CashuMintError until the integration lands", async () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: "abcd".repeat(16),
      locktimeSeconds: Math.floor(Date.now() / 1000) + 3600,
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuMintError);
});

test("createCashuClient.bindProvider throws CashuMintError until the integration lands", async () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  await expect(
    client.bindProvider({
      initialToken: "cashuBplaceholder",
      providerPubkey: "ef12".repeat(16),
      hashHex: VALID_HASH,
      locktimeSeconds: Math.floor(Date.now() / 1000) + 3600,
      customerPubkey: "abcd".repeat(16),
    }),
  ).rejects.toThrow(CashuMintError);
});

test("createCashuClient.redeemHtlc throws CashuMintError until the integration lands", async () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  await expect(
    client.redeemHtlc({
      token: "cashuBplaceholder",
      preimageHex: "00".repeat(32),
      providerSecretKey: new Uint8Array(32),
    }),
  ).rejects.toThrow(CashuMintError);
});

test("validateHashHex accepts a 64-char hex string and lowercases it", () => {
  expect(validateHashHex(VALID_HASH)).toBe(VALID_HASH.toLowerCase());
  expect(validateHashHex(VALID_HASH.toUpperCase())).toBe(VALID_HASH.toLowerCase());
});

test("validateHashHex rejects non-hex or wrong-length input", () => {
  expect(() => validateHashHex("zzzz")).toThrow(CashuClientError);
  expect(() => validateHashHex("00".repeat(31))).toThrow(CashuClientError);
  expect(() => validateHashHex("00".repeat(33))).toThrow(CashuClientError);
});

test("validateLocktime accepts a future timestamp", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  expect(validateLocktime(future)).toBe(future);
});

test("validateLocktime rejects a past or current timestamp", () => {
  const now = Math.floor(Date.now() / 1000);
  expect(() => validateLocktime(now - 1)).toThrow(CashuClientError);
  expect(() => validateLocktime(now)).toThrow(CashuClientError);
});

test("validateLocktime rejects a non-integer", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  expect(() => validateLocktime(future + 0.5)).toThrow(CashuClientError);
});
