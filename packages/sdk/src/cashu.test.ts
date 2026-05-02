import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { Proof, P2PKOptions } from "@cashu/cashu-ts";

import {
  CashuClientError,
  CashuMintError,
  type CashuSendChain,
  type CashuWalletAdapter,
  createCashuClient,
  validateHashHex,
  validateLocktime,
} from "./cashu.ts";

const VALID_HASH = "deadbeef".repeat(8); // 64-char hex
const CUSTOMER_PUBKEY = "abcd".repeat(16);
const PROVIDER_PUBKEY = "ef12".repeat(16);
const FUTURE_LOCKTIME = () => Math.floor(Date.now() / 1000) + 3600;

interface SendCall {
  amount: number;
  proofs: Proof[];
  p2pk?: P2PKOptions;
  privkey?: string | string[];
}

/** Build a minimal CashuWalletAdapter that records the swap and returns mock output proofs. */
function makeFakeWallet(opts: {
  outputProofs: Proof[];
  errorOnSend?: Error;
  /** Fee (sats) per swap call. Defaults to 0 (free regtest mints). */
  fee?: number;
}): { wallet: CashuWalletAdapter; calls: SendCall[] } {
  const calls: SendCall[] = [];
  const wallet: CashuWalletAdapter = {
    ops: {
      send(amount, proofs) {
        const call: SendCall = { amount, proofs };
        calls.push(call);
        const chain: CashuSendChain = {
          asP2PK(p2pk) {
            call.p2pk = p2pk;
            return chain;
          },
          privkey(k) {
            call.privkey = k;
            return chain;
          },
          run() {
            if (opts.errorOnSend) return Promise.reject(opts.errorOnSend);
            return Promise.resolve({ send: opts.outputProofs });
          },
        };
        return chain;
      },
    },
    getFeesForProofs: () => opts.fee ?? 0,
  };
  return { wallet, calls };
}

test("createCashuClient stores the mint URL on the returned client", () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  expect(client.mintUrl).toBe("https://mint.example.org");
});

test("createCashuClient rejects an empty mint URL", () => {
  expect(() => createCashuClient({ mintUrl: "" })).toThrow(CashuClientError);
});

test("buildHtlcLock encodes source proofs without a mint round-trip", async () => {
  const { wallet, calls } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  const sourceProofs: Record<string, unknown>[] = [
    { id: "k1", amount: 600, secret: "sec-a", C: "C-a" },
    { id: "k1", amount: 400, secret: "sec-b", C: "C-b" },
  ];
  const result = await client.buildHtlcLock({
    amountSats: 1000,
    hashHex: VALID_HASH,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: FUTURE_LOCKTIME(),
    sourceProofs,
  });
  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(2);
  expect(result.token.startsWith("cashu")).toBe(true);
  // Phase 1 must NOT touch the mint.
  expect(calls.length).toBe(0);
});

test("buildHtlcLock validates hashHex, amountSats, and locktimeSeconds", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: "not-hex",
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 0,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: Math.floor(Date.now() / 1000) - 1,
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuClientError);
});

test("bindProvider performs an asP2PK swap with hashlock + provider P2PK + locktime + refund", async () => {
  const lockedOutput: Proof[] = [
    { id: "k1", amount: 1000, secret: '["P2PK",{"data":"X"}]', C: "C-bound" },
  ];
  const { wallet, calls } = makeFakeWallet({ outputProofs: lockedOutput });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });

  // Build a Phase-1 token as input.
  const phase1Source: Record<string, unknown>[] = [
    { id: "k1", amount: 1000, secret: "sec-a", C: "C-a" },
  ];
  const phase1 = await client.buildHtlcLock({
    amountSats: 1000,
    hashHex: VALID_HASH,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: FUTURE_LOCKTIME(),
    sourceProofs: phase1Source,
  });

  const lockTime = FUTURE_LOCKTIME();
  const result = await client.bindProvider({
    initialToken: phase1.token,
    providerPubkey: PROVIDER_PUBKEY,
    hashHex: VALID_HASH,
    locktimeSeconds: lockTime,
    customerPubkey: CUSTOMER_PUBKEY,
  });

  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(1);
  expect(calls.length).toBe(1);
  expect(calls[0].amount).toBe(1000);
  expect(calls[0].privkey).toBeUndefined();
  expect(calls[0].p2pk).toBeDefined();
  // The P2PK options must encode the four HTLC requirements.
  // (Probe via the serialized tags shape — cashu-ts represents them as an array of tag tuples.)
  const tagsJson = JSON.stringify(calls[0].p2pk);
  expect(tagsJson).toContain(VALID_HASH);
  expect(tagsJson).toContain(PROVIDER_PUBKEY);
  expect(tagsJson).toContain(CUSTOMER_PUBKEY);
  expect(tagsJson).toContain(String(lockTime));
});

test("bindProvider wraps mint errors in CashuMintError", async () => {
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("mint unavailable"),
  });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  const errSource: Record<string, unknown>[] = [
    { id: "k1", amount: 1000, secret: "sec-a", C: "C-a" },
  ];
  const phase1 = await client.buildHtlcLock({
    amountSats: 1000,
    hashHex: VALID_HASH,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: FUTURE_LOCKTIME(),
    sourceProofs: errSource,
  });
  await expect(
    client.bindProvider({
      initialToken: phase1.token,
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
    }),
  ).rejects.toThrow(CashuMintError);
});

test("redeemHtlc attaches preimage witness, signs with provider key, and swaps for unlocked proofs", async () => {
  // We feed in a fabricated phase-2 token. The real cashu-ts encoder/decoder
  // is used end-to-end here; we just need a valid Token shape on disk.
  const fakeP2PKProof: Proof = {
    id: "k1",
    amount: 1000,
    secret: '["P2PK",{"nonce":"n","data":"D"}]',
    C: "C-bound",
  };
  const phase2Token = await (async () => {
    const { getEncodedToken } = await import("@cashu/cashu-ts");
    return getEncodedToken({ mint: "https://mint.example.org", proofs: [fakeP2PKProof] });
  })();

  const unlockedOutput: Proof[] = [
    { id: "k1", amount: 1000, secret: "plain-secret", C: "C-out" },
  ];
  const { wallet, calls } = makeFakeWallet({ outputProofs: unlockedOutput });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });

  const providerSecretKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) providerSecretKey[i] = i + 1;

  const result = await client.redeemHtlc({
    token: phase2Token,
    preimageHex: "ffeeddcc".repeat(8),
    providerSecretKey,
  });

  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(1);
  expect(calls.length).toBe(1);
  expect(calls[0].privkey).toBeDefined();
  // The provider's privkey was passed to the mint swap as hex (not bytes).
  expect(typeof calls[0].privkey).toBe("string");
  // The send proofs must include a witness containing the preimage.
  const inputProof = calls[0].proofs[0];
  expect(inputProof?.witness).toBeDefined();
  const witness = JSON.parse(String(inputProof?.witness));
  expect(witness.preimage).toBe("ffeeddcc".repeat(8));
});

test("redeemHtlc wraps mint errors in CashuMintError", async () => {
  const fakeP2PKProof: Proof = {
    id: "k1",
    amount: 1000,
    secret: '["P2PK",{"nonce":"n","data":"D"}]',
    C: "C-bound",
  };
  const phase2Token = await (async () => {
    const { getEncodedToken } = await import("@cashu/cashu-ts");
    return getEncodedToken({ mint: "https://mint.example.org", proofs: [fakeP2PKProof] });
  })();

  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("nut-14 witness missing"),
  });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.redeemHtlc({
      token: phase2Token,
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
