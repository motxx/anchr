import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { type Proof, type P2PKOptions, getEncodedToken } from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  CashuClientError,
  CashuMintError,
  type CashuSendChain,
  type CashuWalletAdapter,
  createCashuClient,
  validateHashHex,
  validateLocktime,
} from "./cashu.ts";

const PREIMAGE_HEX = "ffeeddcc".repeat(8);
const VALID_HASH = bytesToHex(sha256(hexToBytes(PREIMAGE_HEX)));
const CUSTOMER_PUBKEY = "abcd".repeat(16);
const PROVIDER_PUBKEY = "ef12".repeat(16);
const FUTURE_LOCKTIME = () => Math.floor(Date.now() / 1000) + 3600;
const CUSTOMER_SECRET = (() => {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i + 1;
  return k;
})();
const PROVIDER_SECRET = (() => {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i + 0x40;
  return k;
})();

const VALID_SOURCE_PROOFS: Record<string, unknown>[] = [
  { id: "k1", amount: 600, secret: "sec-a", C: "C-a" },
  { id: "k1", amount: 400, secret: "sec-b", C: "C-b" },
];

interface SendCall {
  amount: number;
  proofs: Proof[];
  p2pk?: P2PKOptions;
  privkey?: string | string[];
}

/** Build a minimal CashuWalletAdapter that records the swap and returns mock output proofs. */
function makeFakeWallet(opts: {
  /** Sequence of output proof arrays — one per `send().run()` call. */
  outputs?: Proof[][];
  /** Single output (used for every call) — convenience for one-call tests. */
  outputProofs?: Proof[];
  errorOnSend?: Error;
  /** Fee (sats) per swap call. Defaults to 0 (free regtest mints). */
  fee?: number;
  /** Keyset IDs the fake wallet knows. Defaults to ["k1"]. */
  keysetIds?: readonly string[];
}): { wallet: CashuWalletAdapter; calls: SendCall[] } {
  const calls: SendCall[] = [];
  const outputs = opts.outputs ?? [];
  let outputIdx = 0;
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
            const out = outputs[outputIdx++] ?? opts.outputProofs ?? [];
            return Promise.resolve({ send: out });
          },
        };
        return chain;
      },
    },
    getFeesForProofs: () => opts.fee ?? 0,
    keyChain: {
      getAllKeysetIds: () => opts.keysetIds ?? ["k1"],
    },
  };
  return { wallet, calls };
}

/** Build a real cashuB-encoded Phase-2-shaped HTLC token for redeem tests. */
function makeHtlcToken(hashHex: string, providerPubkey: string, locktime: number): string {
  const secret = JSON.stringify([
    "HTLC",
    {
      nonce: "01".repeat(16),
      data: hashHex,
      tags: [
        ["pubkeys", `02${providerPubkey}`],
        ["locktime", String(locktime)],
        ["sigflag", "SIG_ALL"],
      ],
    },
  ]);
  const proof: Proof = {
    id: "k1",
    amount: 1000,
    secret,
    C: "02" + "ab".repeat(32),
  };
  return getEncodedToken({ mint: "https://mint.example.org", proofs: [proof] });
}

test("createCashuClient stores the mint URL on the returned client", () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  expect(client.mintUrl).toBe("https://mint.example.org");
});

test("createCashuClient rejects an empty mint URL", () => {
  expect(() => createCashuClient({ mintUrl: "" })).toThrow(CashuClientError);
});

test("buildHtlcLock performs a Phase-1 mint swap locked to P2PK(customer) with no hashlock", async () => {
  const phase1Output: Proof[] = [
    { id: "k1", amount: 1000, secret: '["P2PK",{"data":"' + CUSTOMER_PUBKEY + '"}]', C: "C-1" },
  ];
  const { wallet, calls } = makeFakeWallet({ outputProofs: phase1Output });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });

  const result = await client.buildHtlcLock({
    amountSats: 1000,
    hashHex: VALID_HASH,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: FUTURE_LOCKTIME(),
    sourceProofs: VALID_SOURCE_PROOFS,
  });

  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(1);
  expect(result.token.startsWith("cashu")).toBe(true);

  expect(calls.length).toBe(1);
  expect(calls[0].amount).toBe(1000);
  expect(calls[0].privkey).toBeUndefined();
  expect(calls[0].p2pk).toBeDefined();
  const tagsJson = JSON.stringify(calls[0].p2pk);
  expect(tagsJson).toContain(CUSTOMER_PUBKEY);
  expect(tagsJson).not.toContain(VALID_HASH);
});

test("buildHtlcLock validates hashHex, amountSats, locktimeSeconds, and sourceProofs", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: "not-hex",
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: VALID_SOURCE_PROOFS,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 0,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: VALID_SOURCE_PROOFS,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: Math.floor(Date.now() / 1000) - 1,
      sourceProofs: VALID_SOURCE_PROOFS,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuClientError);
});

test("buildHtlcLock rejects malformed source proofs (caller misuse)", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: [{ amount: 1000 }],
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: ["not-an-object"],
    }),
  ).rejects.toThrow(CashuClientError);
});

test("buildHtlcLock wraps mint errors in CashuMintError", async () => {
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("mint unavailable"),
  });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.buildHtlcLock({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      sourceProofs: VALID_SOURCE_PROOFS,
    }),
  ).rejects.toThrow(CashuMintError);
});

test("bindProvider signs Phase-1 input with customer privkey and locks output with hashlock + provider P2PK + locktime + refund", async () => {
  const phase2Output: Proof[] = [
    { id: "k1", amount: 1000, secret: '["HTLC",{"data":"' + VALID_HASH + '"}]', C: "C-2" },
  ];
  const { wallet, calls } = makeFakeWallet({ outputProofs: phase2Output });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });

  const phase1Proofs = [
    { id: "k1", amount: 1000, secret: '["P2PK",{"data":"' + CUSTOMER_PUBKEY + '"}]', C: "C-1" },
  ];

  const lockTime = FUTURE_LOCKTIME();
  const result = await client.bindProvider({
    initialProofs: phase1Proofs,
    providerPubkey: PROVIDER_PUBKEY,
    hashHex: VALID_HASH,
    locktimeSeconds: lockTime,
    customerPubkey: CUSTOMER_PUBKEY,
    customerSecretKey: CUSTOMER_SECRET,
  });

  expect(result.amountSats).toBe(1000);
  expect(calls.length).toBe(1);
  const phase2Call = calls[0]!;
  expect(typeof phase2Call.privkey).toBe("string");
  expect(phase2Call.p2pk).toBeDefined();
  const tagsJson = JSON.stringify(phase2Call.p2pk);
  expect(tagsJson).toContain(VALID_HASH);
  expect(tagsJson).toContain(PROVIDER_PUBKEY);
  expect(tagsJson).toContain(CUSTOMER_PUBKEY);
  expect(tagsJson).toContain(String(lockTime));
});

test("bindProvider rejects a missing or wrong-shape customerSecretKey", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  const phase1Proofs = [
    { id: "k1", amount: 1000, secret: '["P2PK",{"data":"' + CUSTOMER_PUBKEY + '"}]', C: "C-1" },
  ];
  await expect(
    client.bindProvider({
      initialProofs: phase1Proofs,
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
      customerSecretKey: new Uint8Array(31),
    }),
  ).rejects.toThrow(CashuClientError);
});

test("bindProvider rejects malformed initialProofs (caller misuse)", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.bindProvider({
      initialProofs: [],
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.bindProvider({
      initialProofs: [{ amount: 1000 }],
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
});

test("bindProvider wraps mint errors in CashuMintError", async () => {
  const phase1Proofs = [
    { id: "k1", amount: 1000, secret: '["P2PK",{"data":"' + CUSTOMER_PUBKEY + '"}]', C: "C-1" },
  ];
  const failFake = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("mint unavailable"),
  });
  const failClient = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet: failFake.wallet,
  });
  await expect(
    failClient.bindProvider({
      initialProofs: phase1Proofs,
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuMintError);
});

test("redeemHtlc verifies preimage matches each proof's hashlock before mint round-trip", async () => {
  const lockTime = FUTURE_LOCKTIME();
  const goodToken = makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime);
  const wrongToken = makeHtlcToken("aa".repeat(32), PROVIDER_PUBKEY, lockTime);

  const { wallet, calls } = makeFakeWallet({
    outputProofs: [{ id: "k1", amount: 1000, secret: "plain", C: "C-out" }],
  });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });

  await expect(
    client.redeemHtlc({
      token: wrongToken,
      preimageHex: PREIMAGE_HEX,
      providerSecretKey: PROVIDER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
  expect(calls.length).toBe(0);

  const result = await client.redeemHtlc({
    token: goodToken,
    preimageHex: PREIMAGE_HEX,
    providerSecretKey: PROVIDER_SECRET,
  });
  expect(result.amountSats).toBe(1000);
  expect(calls.length).toBe(1);
  expect(typeof calls[0].privkey).toBe("string");
  const witness = JSON.parse(String(calls[0].proofs[0]?.witness));
  expect(witness.preimage).toBe(PREIMAGE_HEX);
});

test("redeemHtlc wraps mint errors in CashuMintError", async () => {
  const goodToken = makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, FUTURE_LOCKTIME());
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("nut-14 witness missing"),
  });
  const client = createCashuClient({ mintUrl: "https://mint.example.org", wallet });
  await expect(
    client.redeemHtlc({
      token: goodToken,
      preimageHex: PREIMAGE_HEX,
      providerSecretKey: PROVIDER_SECRET,
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
