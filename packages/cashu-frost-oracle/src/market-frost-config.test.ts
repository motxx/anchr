import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  toYesFrostNodeConfig,
  toNoFrostNodeConfig,
  saveMarketFrostNodeConfigAsync,
  loadMarketFrostNodeConfigAsync,
  loadMarketFrostNodeConfig,
  encryptMarketFrostNodeConfig,
} from "./market-frost-config.ts";
import type { MarketFrostNodeConfig } from "./market-frost-config.ts";

function makeMockConfig(): MarketFrostNodeConfig {
  return {
    signer_index: 1,
    total_signers: 3,
    threshold: 2,
    key_package: { yes_key: "yes_secret_share" },
    pubkey_package: { yes_pubkey: "yes_pubkey_package" },
    group_pubkey: "aa".repeat(32),
    peers: [
      { signer_index: 1, endpoint: "http://localhost:4001" },
      { signer_index: 2, endpoint: "http://localhost:4002" },
      { signer_index: 3, endpoint: "http://localhost:4003" },
    ],
    key_package_no: { no_key: "no_secret_share" },
    pubkey_package_no: { no_pubkey: "no_pubkey_package" },
    group_pubkey_no: "bb".repeat(32),
  };
}

test("toYesFrostNodeConfig extracts YES group fields", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);

  expect(yesConfig.signer_index).toBe(1);
  expect(yesConfig.total_signers).toBe(3);
  expect(yesConfig.threshold).toBe(2);
  expect(yesConfig.key_package).toEqual({ yes_key: "yes_secret_share" });
  expect(yesConfig.pubkey_package).toEqual({ yes_pubkey: "yes_pubkey_package" });
  expect(yesConfig.group_pubkey).toBe("aa".repeat(32));
  expect(yesConfig.peers.length).toBe(3);
});

test("toNoFrostNodeConfig extracts NO group fields", () => {
  const config = makeMockConfig();
  const noConfig = toNoFrostNodeConfig(config);

  expect(noConfig.signer_index).toBe(1);
  expect(noConfig.total_signers).toBe(3);
  expect(noConfig.threshold).toBe(2);
  expect(noConfig.key_package).toEqual({ no_key: "no_secret_share" });
  expect(noConfig.pubkey_package).toEqual({ no_pubkey: "no_pubkey_package" });
  expect(noConfig.group_pubkey).toBe("bb".repeat(32));
  expect(noConfig.peers.length).toBe(3);
});

test("YES and NO configs have different group pubkeys", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  expect(yesConfig.group_pubkey).not.toBe(noConfig.group_pubkey);
});

test("YES and NO configs share the same peer list", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  expect(yesConfig.peers).toEqual(noConfig.peers);
});

test("MarketFrostNodeConfig preserves signer identity across groups", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  // Same signer in both groups
  expect(yesConfig.signer_index).toBe(noConfig.signer_index);
  expect(yesConfig.threshold).toBe(noConfig.threshold);
  expect(yesConfig.total_signers).toBe(noConfig.total_signers);
});

// --- Encrypted-at-rest tests -----------------------------------------------

async function withTempFile<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const path = await Deno.makeTempFile({ prefix: "frost-cfg-", suffix: ".json" });
  try {
    return await fn(path);
  } finally {
    try { await Deno.remove(path); } catch { /* ignore */ }
  }
}

test("plaintext save/load roundtrip preserves all fields", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original);
    const loaded = await loadMarketFrostNodeConfigAsync(path);
    expect(loaded).toEqual(original);
  });
});

test("encrypted save/load roundtrip preserves all fields", async () => {
  const original = makeMockConfig();
  const passphrase = "correct horse battery staple";
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase });
    const loaded = await loadMarketFrostNodeConfigAsync(path, { passphrase });
    expect(loaded).toEqual(original);
  });
});

test("encrypted file written to disk is an envelope, not plaintext", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase: "pass" });
    const onDisk = JSON.parse(await Deno.readTextFile(path));
    expect(onDisk.version).toBe(1);
    expect(onDisk.algorithm).toBe("aes-256-gcm");
    expect(onDisk.kdf).toBe("pbkdf2-sha256");
    expect(typeof onDisk.salt).toBe("string");
    expect(typeof onDisk.iv).toBe("string");
    expect(typeof onDisk.ciphertext).toBe("string");
    // Secret material must not appear in plaintext on disk.
    const raw = await Deno.readTextFile(path);
    expect(raw).not.toContain("yes_secret_share");
    expect(raw).not.toContain("no_secret_share");
  });
});

test("encrypted file cannot be loaded without a passphrase", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase: "pass" });
    await expect(loadMarketFrostNodeConfigAsync(path)).rejects.toThrow(/encrypted/i);
  });
});

test("encrypted file rejects wrong passphrase with uniform error", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase: "right" });
    await expect(loadMarketFrostNodeConfigAsync(path, { passphrase: "wrong" }))
      .rejects.toThrow(/decryption failed/i);
  });
});

test("sync loader rejects encrypted file with actionable message", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase: "pass" });
    expect(() => loadMarketFrostNodeConfig(path)).toThrow(/encrypted/i);
  });
});

test("plaintext loader still works through the async path (back-compat)", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    // Write plaintext directly.
    await Deno.writeTextFile(path, JSON.stringify(original));
    const loaded = await loadMarketFrostNodeConfigAsync(path);
    expect(loaded).toEqual(original);
  });
});

test("each encryption uses a fresh salt and IV (no nonce reuse)", async () => {
  const original = makeMockConfig();
  const a = await encryptMarketFrostNodeConfig(original, "pass");
  const b = await encryptMarketFrostNodeConfig(original, "pass");
  expect(a.salt).not.toBe(b.salt);
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toBe(b.ciphertext);
});

test("encryption requires a non-empty passphrase", async () => {
  const original = makeMockConfig();
  await expect(encryptMarketFrostNodeConfig(original, "")).rejects.toThrow(
    /passphrase required/i,
  );
});

test("tampered ciphertext fails GCM authentication", async () => {
  const original = makeMockConfig();
  await withTempFile(async (path) => {
    await saveMarketFrostNodeConfigAsync(path, original, { passphrase: "pass" });
    const envelope = JSON.parse(await Deno.readTextFile(path));
    // Flip one byte in the base64 ciphertext (re-encode after mutating).
    const ct = atob(envelope.ciphertext);
    const bytes = new Uint8Array(ct.length);
    for (let i = 0; i < ct.length; i++) bytes[i] = ct.charCodeAt(i);
    bytes[0] ^= 0x01;
    let out = "";
    for (const b of bytes) out += String.fromCharCode(b);
    envelope.ciphertext = btoa(out);
    await Deno.writeTextFile(path, JSON.stringify(envelope));
    await expect(loadMarketFrostNodeConfigAsync(path, { passphrase: "pass" }))
      .rejects.toThrow(/decryption failed/i);
  });
});
