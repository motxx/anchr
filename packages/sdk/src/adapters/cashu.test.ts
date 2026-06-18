import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createDLEQProof,
  getEncodedToken,
  hashToCurve,
  type OutputDataLike,
  type P2PKOptions,
  pointFromHex,
  type Proof,
} from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  CashuClientError,
  CashuMintError,
  CashuMintUncertainError,
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
const MINT_PRIVATE_KEY_HEX = "01".padStart(64, "0");
const MINT_PUBLIC_KEY_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const DLEQ_BLINDING_FACTOR = 1n;
const DLEQ_BLINDING_FACTOR_HEX = "01";
const proofSecretEncoder = new TextEncoder();
function hashProofSecretToCurve(
  secret: string,
): ReturnType<typeof hashToCurve> {
  return Reflect.apply(hashToCurve, undefined, [
    proofSecretEncoder.encode(secret),
  ]) as ReturnType<typeof hashToCurve>;
}

const VALID_SOURCE_PROOFS: Record<string, unknown>[] = [
  {
    id: "00ad268c4d1f5826",
    amount: 600,
    secret: "sec-a",
    C: "02" + "aa".repeat(32),
  },
  {
    id: "00ad268c4d1f5826",
    amount: 400,
    secret: "sec-b",
    C: "02" + "bb".repeat(32),
  },
];
const VALID_FUNDING_PROOFS: Record<string, unknown>[] = [
  ...VALID_SOURCE_PROOFS,
  {
    id: "00ad268c4d1f5826",
    amount: 502,
    secret: "sec-c",
    C: "02" + "cc".repeat(32),
  },
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
  keepProofs?: Proof[];
  errorOnSend?: Error;
  states?: Array<{ state: string }> | Error;
  /** Fee (sats) per swap call. Defaults to 0 (free regtest mints). */
  fee?: number;
  /** Keyset IDs the fake wallet knows. Defaults to ["00ad268c4d1f5826"]. */
  keysetIds?: readonly string[];
}): { wallet: CashuWalletAdapter; calls: SendCall[]; loadMintCalls: number[] } {
  const calls: SendCall[] = [];
  const loadMintCalls: number[] = [];
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
            return Promise.resolve({ send: out, keep: opts.keepProofs ?? [] });
          },
        };
        return chain;
      },
    },
    getFeesForProofs: () => opts.fee ?? 0,
    keyChain: {
      getAllKeysetIds: () => opts.keysetIds ?? ["00ad268c4d1f5826"],
    },
    getKeyset: () => ({
      id: "00ad268c4d1f5826",
      keys: {
        1000: MINT_PUBLIC_KEY_HEX,
      },
    }),
    checkProofsStates(proofs) {
      if (opts.states instanceof Error) return Promise.reject(opts.states);
      return Promise.resolve(
        opts.states ?? proofs.map(() => ({ state: "UNSPENT" })),
      );
    },
    loadMint(forceRefresh) {
      loadMintCalls.push(forceRefresh === true ? 1 : 0);
      return Promise.resolve();
    },
  };
  return { wallet, calls, loadMintCalls };
}

function makeMintSignedProof(
  amount: number,
  secret: string,
  options?: { C?: string; includeDleq?: boolean },
): Proof {
  const point = hashProofSecretToCurve(secret);
  const mintPublicKey = pointFromHex(MINT_PUBLIC_KEY_HEX);
  const blindedPoint = point.add(
    mintPublicKey.multiply(DLEQ_BLINDING_FACTOR),
  );
  const proof = createDLEQProof(
    blindedPoint,
    hexToBytes(MINT_PRIVATE_KEY_HEX),
  );
  return {
    id: "00ad268c4d1f5826",
    amount,
    secret,
    C: options?.C ?? point.multiply(1n).toHex(true),
    ...(options?.includeDleq === false ? {} : {
      dleq: {
        s: bytesToHex(proof.s),
        e: bytesToHex(proof.e),
        r: DLEQ_BLINDING_FACTOR_HEX,
      },
    }),
  };
}

/** Build a real cashuB-encoded Provider-bound HTLC token for redeem tests. */
function makeHtlcToken(
  hashHex: string,
  providerPubkey: string,
  locktime: number,
  options?: {
    amount?: number;
    customerPubkey?: string;
    mint?: string;
    tags?: string[][];
    C?: string;
    includeDleq?: boolean;
    duplicateProof?: boolean;
  },
): string {
  const tags = options?.tags ?? [
    ["pubkeys", `02${providerPubkey}`],
    ["locktime", String(locktime)],
    ["refund", `02${options?.customerPubkey ?? CUSTOMER_PUBKEY}`],
    ["sigflag", "SIG_ALL"],
  ];
  const secret = JSON.stringify([
    "HTLC",
    {
      nonce: "01".repeat(16),
      data: hashHex,
      tags,
    },
  ]);
  const proof = makeMintSignedProof(
    options?.amount ?? 1000,
    secret,
    { C: options?.C, includeDleq: options?.includeDleq },
  );
  return getEncodedToken({
    mint: options?.mint ?? "https://mint.example.org",
    proofs: options?.duplicateProof ? [proof, proof] : [proof],
  });
}

test("createCashuClient stores the mint URL on the returned client", () => {
  const client = createCashuClient({ mintUrl: "https://mint.example.org" });
  expect(client.mintUrl).toBe("https://mint.example.org");
});

test("verifyProviderPaymentLock accepts a Provider-bound Cashu HTLC token", async () => {
  const { wallet, loadMintCalls } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();
  const token = makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime);

  const result = await client.verifyProviderPaymentLock({
    token,
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  });

  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(1);
  expect(loadMintCalls).toEqual([1]);
});

test("verifyProviderPaymentLock rejects tokens that are not bound to the expected conditions", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();
  const base = {
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  };
  const validToken = makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime);
  const plainToken = getEncodedToken({
    mint: "https://mint.example.org",
    proofs: VALID_SOURCE_PROOFS as Proof[],
  });

  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: plainToken,
  })).rejects.toThrow(CashuClientError);
  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: validToken,
    hashHex: "ff".repeat(32),
  })).rejects.toThrow(CashuClientError);
  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: validToken,
    providerPubkey: "11".repeat(32),
  })).rejects.toThrow(CashuClientError);
  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: validToken,
    locktimeSeconds: lockTime + 1,
  })).rejects.toThrow(CashuClientError);
  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      mint: "https://other-mint.example.org",
    }),
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects locks that require unsupported signatures", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();

  await expect(client.verifyProviderPaymentLock({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      tags: [
        ["pubkeys", `02${PROVIDER_PUBKEY}`],
        ["locktime", String(lockTime)],
        ["refund", `02${CUSTOMER_PUBKEY}`],
        ["n_sigs", "2"],
        ["sigflag", "SIG_ALL"],
      ],
    }),
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects expired locks", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const expiredLockTime = Math.floor(Date.now() / 1000) - 1;

  await expect(client.verifyProviderPaymentLock({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, expiredLockTime),
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: expiredLockTime,
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects locks without enough remaining time", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const nearExpiryLockTime = Math.floor(Date.now() / 1000) + 5;

  await expect(client.verifyProviderPaymentLock({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, nearExpiryLockTime),
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: nearExpiryLockTime,
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects spent proofs before work", async () => {
  const { wallet } = makeFakeWallet({ states: [{ state: "SPENT" }] });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();

  await expect(client.verifyProviderPaymentLock({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime),
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects forged or unverifiable proof signatures", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();
  const base = {
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  };

  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      C: "02" + "ab".repeat(32),
    }),
  })).rejects.toThrow(CashuClientError);

  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      includeDleq: false,
    }),
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock rejects duplicate proofs before summing amount", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();

  await expect(client.verifyProviderPaymentLock({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      amount: 1000,
      duplicateProof: true,
    }),
    amountSats: 2000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  })).rejects.toThrow(CashuClientError);
});

test("verifyProviderPaymentLock compares single-value tags by position", async () => {
  const { wallet } = makeFakeWallet({});
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  const lockTime = FUTURE_LOCKTIME();
  const base = {
    amountSats: 1000,
    hashHex: VALID_HASH,
    providerPubkey: PROVIDER_PUBKEY,
    customerPubkey: CUSTOMER_PUBKEY,
    locktimeSeconds: lockTime,
  };

  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      tags: [
        ["pubkeys", `02${PROVIDER_PUBKEY}`],
        ["locktime", String(lockTime - 1), String(lockTime)],
        ["refund", `02${CUSTOMER_PUBKEY}`],
        ["sigflag", "SIG_ALL"],
      ],
    }),
  })).rejects.toThrow(CashuClientError);

  await expect(client.verifyProviderPaymentLock({
    ...base,
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime, {
      tags: [
        ["pubkeys", `02${PROVIDER_PUBKEY}`],
        ["locktime", String(lockTime)],
        ["refund", `02${CUSTOMER_PUBKEY}`],
        ["sigflag", "SIG_INPUTS", "SIG_ALL"],
      ],
    }),
  })).rejects.toThrow(CashuClientError);
});

test("createCashuClient rejects an empty mint URL", () => {
  expect(() => createCashuClient({ mintUrl: "" })).toThrow(CashuClientError);
});

test("bindProvider performs one direct mint swap for the selected Provider amount", async () => {
  const providerOutput: Proof[] = [
    {
      id: "00ad268c4d1f5826",
      amount: 1000,
      secret: '["HTLC",{"data":"' + VALID_HASH + '"}]',
      C: "02" + "dd".repeat(32),
    },
  ];
  const changeProofs: Proof[] = [
    {
      id: "00ad268c4d1f5826",
      amount: 500,
      secret: "change-sec",
      C: "02" + "cc".repeat(32),
    },
  ];
  const { wallet, calls } = makeFakeWallet({
    outputProofs: providerOutput,
    keepProofs: changeProofs,
    fee: 2,
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

  const lockTime = FUTURE_LOCKTIME();
  const result = await client.bindProvider({
    amountSats: 1000,
    fundingProofs: VALID_FUNDING_PROOFS,
    providerPubkey: PROVIDER_PUBKEY,
    hashHex: VALID_HASH,
    locktimeSeconds: lockTime,
    customerPubkey: CUSTOMER_PUBKEY,
    customerSecretKey: CUSTOMER_SECRET,
  });

  expect(result.amountSats).toBe(1000);
  expect(result.proofs.length).toBe(1);
  expect(result.changeProofs).toEqual(changeProofs);
  expect(result.token.startsWith("cashu")).toBe(true);

  expect(calls.length).toBe(1);
  expect(calls[0].amount).toBe(1000);
  expect(typeof calls[0].privkey).toBe("string");
  expect(calls[0].p2pk).toBeDefined();
  const tagsJson = JSON.stringify(calls[0].p2pk);
  expect(tagsJson).toContain(VALID_HASH);
  expect(tagsJson).toContain(PROVIDER_PUBKEY);
  expect(tagsJson).toContain(CUSTOMER_PUBKEY);
  expect(tagsJson).toContain(String(lockTime));
});

test("bindProvider validates hashHex, amountSats, locktimeSeconds, and fundingProofs", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: "not-hex",
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      fundingProofs: VALID_FUNDING_PROOFS,
      providerPubkey: PROVIDER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
  for (
    const amountSats of [
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]
  ) {
    await expect(
      client.bindProvider({
        amountSats,
        hashHex: VALID_HASH,
        customerPubkey: CUSTOMER_PUBKEY,
        locktimeSeconds: FUTURE_LOCKTIME(),
        fundingProofs: VALID_SOURCE_PROOFS,
        providerPubkey: PROVIDER_PUBKEY,
        customerSecretKey: CUSTOMER_SECRET,
      }),
    ).rejects.toThrow(CashuClientError);
  }
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: Math.floor(Date.now() / 1000) - 1,
      fundingProofs: VALID_SOURCE_PROOFS,
      providerPubkey: PROVIDER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      fundingProofs: [],
      providerPubkey: PROVIDER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
});

test("bindProvider rejects malformed funding proofs (caller misuse)", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      fundingProofs: [{ amount: 1000 }],
      providerPubkey: PROVIDER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      fundingProofs: ["not-an-object"],
      providerPubkey: PROVIDER_PUBKEY,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuClientError);
});

test("bindProvider rejects funding proofs that cannot cover amount plus mint fee", async () => {
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    fee: 2,
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      providerPubkey: PROVIDER_PUBKEY,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      fundingProofs: VALID_SOURCE_PROOFS,
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuMintError);
});

test("bindProvider wraps mint errors in CashuMintError", async () => {
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("mint unavailable"),
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  await expect(
    client.bindProvider({
      amountSats: 1000,
      hashHex: VALID_HASH,
      fundingProofs: VALID_SOURCE_PROOFS,
      providerPubkey: PROVIDER_PUBKEY,
      customerPubkey: CUSTOMER_PUBKEY,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerSecretKey: CUSTOMER_SECRET,
    }),
  ).rejects.toThrow(CashuMintError);
});

test("bindProvider rejects a missing or wrong-shape customerSecretKey", async () => {
  const { wallet } = makeFakeWallet({ outputProofs: [] });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
  await expect(
    client.bindProvider({
      amountSats: 1000,
      fundingProofs: VALID_SOURCE_PROOFS,
      providerPubkey: PROVIDER_PUBKEY,
      hashHex: VALID_HASH,
      locktimeSeconds: FUTURE_LOCKTIME(),
      customerPubkey: CUSTOMER_PUBKEY,
      customerSecretKey: new Uint8Array(31),
    }),
  ).rejects.toThrow(CashuClientError);
});

test("redeemHtlc verifies preimage matches each proof's hashlock before mint round-trip", async () => {
  const lockTime = FUTURE_LOCKTIME();
  const goodToken = makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, lockTime);
  const wrongToken = makeHtlcToken("aa".repeat(32), PROVIDER_PUBKEY, lockTime);

  const { wallet, calls } = makeFakeWallet({
    outputProofs: [{
      id: "00ad268c4d1f5826",
      amount: 1000,
      secret: "plain",
      C: "02" + "cc".repeat(32),
    }],
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

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
  const goodToken = makeHtlcToken(
    VALID_HASH,
    PROVIDER_PUBKEY,
    FUTURE_LOCKTIME(),
  );
  const { wallet } = makeFakeWallet({
    outputProofs: [],
    errorOnSend: new Error("nut-14 witness missing"),
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });
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
  expect(validateHashHex(VALID_HASH.toUpperCase())).toBe(
    VALID_HASH.toLowerCase(),
  );
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

// --- Interrupted-swap recovery (committed swap whose response was lost) ---

const G_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

function makeRecoveryKeyset(): { id: string; keys: Record<number, string> } {
  const keys: Record<number, string> = {};
  for (const amount of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
    keys[amount] = G_HEX;
  }
  return { id: "00ad268c4d1f5826", keys };
}

function makeRecoveryWallet(opts: {
  states: Array<{ state: string }> | Error;
  restore?: "echo" | Error;
}): CashuWalletAdapter {
  let registered: OutputDataLike[] = [];
  return {
    ops: {
      send() {
        const chain: CashuSendChain = {
          asP2PK: () => chain,
          privkey: () => chain,
          asCustom: (data) => {
            registered = data;
            return chain;
          },
          run: () => Promise.reject(new Error("simulated network loss")),
        };
        return chain;
      },
    },
    getFeesForProofs: () => 0,
    keyChain: { getAllKeysetIds: () => ["00ad268c4d1f5826"] },
    getKeyset: makeRecoveryKeyset,
    checkProofsStates() {
      if (opts.states instanceof Error) return Promise.reject(opts.states);
      return Promise.resolve(opts.states);
    },
    mint: {
      restore({ outputs }) {
        if (opts.restore instanceof Error) return Promise.reject(opts.restore);
        return Promise.resolve({
          outputs: registered.map((o) => o.blindedMessage),
          signatures: registered.map((o) => ({
            id: o.blindedMessage.id,
            amount: o.blindedMessage.amount,
            C_: G_HEX,
          })),
        });
      },
    },
  };
}

test("redeemHtlc reports a retry-safe failure when inputs stay unspent", async () => {
  const wallet = makeRecoveryWallet({ states: [{ state: "UNSPENT" }] });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

  const promise = client.redeemHtlc({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, FUTURE_LOCKTIME()),
    preimageHex: PREIMAGE_HEX,
    providerSecretKey: PROVIDER_SECRET,
  });
  await expect(promise).rejects.toThrow(CashuMintError);
  await promise.catch((err) => {
    expect(err).not.toBeInstanceOf(CashuMintUncertainError);
    expect(String(err.message)).toContain("safe to retry");
  });
});

test("redeemHtlc recovers committed outputs via NUT-09 when inputs are spent", async () => {
  const wallet = makeRecoveryWallet({
    states: [{ state: "SPENT" }],
    restore: "echo",
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

  const result = await client.redeemHtlc({
    token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, FUTURE_LOCKTIME()),
    preimageHex: PREIMAGE_HEX,
    providerSecretKey: PROVIDER_SECRET,
  });
  // The swap committed mint-side; the redeem recovers the pre-registered
  // outputs instead of reporting total loss.
  expect(result.proofs.length).toBeGreaterThan(0);
  expect(result.amountSats).toBe(1000);
});

test("redeemHtlc surfaces a distinct uncertain error when state cannot be checked", async () => {
  const wallet = makeRecoveryWallet({ states: new Error("mint unreachable") });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

  await expect(
    client.redeemHtlc({
      token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, FUTURE_LOCKTIME()),
      preimageHex: PREIMAGE_HEX,
      providerSecretKey: PROVIDER_SECRET,
    }),
  ).rejects.toThrow(CashuMintUncertainError);
});

test("redeemHtlc surfaces an uncertain error when spent inputs cannot be restored", async () => {
  const wallet = makeRecoveryWallet({
    states: [{ state: "SPENT" }],
    restore: new Error("restore endpoint down"),
  });
  const client = createCashuClient({
    mintUrl: "https://mint.example.org",
    wallet,
  });

  await expect(
    client.redeemHtlc({
      token: makeHtlcToken(VALID_HASH, PROVIDER_PUBKEY, FUTURE_LOCKTIME()),
      preimageHex: PREIMAGE_HEX,
      providerSecretKey: PROVIDER_SECRET,
    }),
  ).rejects.toThrow(CashuMintUncertainError);
});
