/**
 * Tests for market-wallet.ts — user proof management.
 *
 * Covers getUserBalance, creditUser, debitUser, and the
 * createMarketWallet factory.
 */

import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { Proof, Wallet } from "@cashu/cashu-ts";
import {
  createMarketWallet,
  creditUser,
  debitUser,
  getUserBalance,
} from "./market-wallet.ts";

/** Create a minimal Cashu Proof stub with given amount. */
function makeProof(amount: number, id = "test-keyset"): Proof {
  const rand = crypto.randomUUID().replace(/-/g, "");
  return {
    id,
    amount,
    C: `02${rand}`,
    secret: `secret_${rand}`,
  } as Proof;
}

/** Create a mock Cashu Wallet that records send() calls. */
function makeMockWallet(opts?: {
  sendResult?: { send: Proof[]; keep: Proof[] };
  sendError?: Error;
}): Wallet {
  const sendResult = opts?.sendResult ?? { send: [], keep: [] };
  const sendError = opts?.sendError;

  const mockSend = (_amount: number, _proofs: Proof[]) => ({
    asP2PK: () => ({
      run: async () => {
        if (sendError) throw sendError;
        return sendResult;
      },
    }),
    run: async () => {
      if (sendError) throw sendError;
      return sendResult;
    },
  });

  // Test-only stub: a Proxy traps all WalletOps method accesses so unimplemented
  // calls fail loudly instead of being silently typed away with `as unknown as`.
  // Only `send` is exercised by getUserBalance / sendToHtlc.
  const opsStub = new Proxy({} as Wallet["ops"], {
    get(_target, prop) {
      if (prop === "send") return mockSend;
      throw new Error(
        `market-wallet test stub: unimplemented WalletOps method "${
          String(prop)
        }"`,
      );
    },
  });
  const stub: Pick<Wallet, "loadMint" | "ops" | "getFeesForProofs"> = {
    loadMint: async () => {},
    ops: opsStub,
    getFeesForProofs: () => 0,
  };
  return stub as Wallet;
}

describe("getUserBalance", () => {
  let store: Map<string, Proof[]>;

  beforeEach(() => {
    store = new Map();
  });

  test("returns 0 for unknown pubkey", () => {
    expect(getUserBalance(store, "alice")).toBe(0);
  });

  test("returns sum of proof amounts", () => {
    store.set("alice", [makeProof(100), makeProof(50)]);
    expect(getUserBalance(store, "alice")).toBe(150);
  });

  test("returns 0 for empty proof array", () => {
    store.set("bob", []);
    expect(getUserBalance(store, "bob")).toBe(0);
  });
});

describe("creditUser", () => {
  let store: Map<string, Proof[]>;

  beforeEach(() => {
    store = new Map();
  });

  test("appends proofs to empty store", () => {
    const proofs = [makeProof(200)];
    creditUser(store, "alice", proofs);
    expect(getUserBalance(store, "alice")).toBe(200);
    expect(store.get("alice")).toHaveLength(1);
  });

  test("appends proofs to existing balance", () => {
    store.set("alice", [makeProof(100)]);
    creditUser(store, "alice", [makeProof(50), makeProof(25)]);
    expect(getUserBalance(store, "alice")).toBe(175);
    expect(store.get("alice")).toHaveLength(3);
  });

  test("does not affect other users", () => {
    creditUser(store, "alice", [makeProof(100)]);
    creditUser(store, "bob", [makeProof(200)]);
    expect(getUserBalance(store, "alice")).toBe(100);
    expect(getUserBalance(store, "bob")).toBe(200);
  });
});

describe("debitUser", () => {
  let store: Map<string, Proof[]>;

  beforeEach(() => {
    store = new Map();
  });

  test("returns null when balance is insufficient", async () => {
    store.set("alice", [makeProof(50)]);
    const wallet = makeMockWallet();
    const result = await debitUser(store, "alice", 100, wallet);
    expect(result).toBeNull();
  });

  test("returns null for unknown user", async () => {
    const wallet = makeMockWallet();
    const result = await debitUser(store, "nobody", 10, wallet);
    expect(result).toBeNull();
  });

  test("deducts exact-match proofs without splitting", async () => {
    const p1 = makeProof(100);
    const p2 = makeProof(50);
    store.set("alice", [p1, p2]);

    const wallet = makeMockWallet();
    const result = await debitUser(store, "alice", 100, wallet);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].amount).toBe(100);
    expect(getUserBalance(store, "alice")).toBe(50);
  });

  test("deducts multiple proofs for exact total", async () => {
    const p1 = makeProof(60);
    const p2 = makeProof(40);
    store.set("alice", [p1, p2]);

    const wallet = makeMockWallet();
    const result = await debitUser(store, "alice", 100, wallet);

    expect(result).not.toBeNull();
    expect(result!.reduce((s, p) => s + p.amount, 0)).toBe(100);
    expect(getUserBalance(store, "alice")).toBe(0);
  });

  test("uses wallet.ops.send().run() for splitting when over-selected", async () => {
    const p1 = makeProof(80);
    const p2 = makeProof(50);
    store.set("alice", [p1, p2]);

    const sendProof = makeProof(70);
    const keepProof = makeProof(10);
    const wallet = makeMockWallet({
      sendResult: { send: [sendProof], keep: [keepProof] },
    });

    const result = await debitUser(store, "alice", 70, wallet);

    expect(result).not.toBeNull();
    expect(result!).toEqual([sendProof]);
    expect(getUserBalance(store, "alice")).toBe(60);
  });

  test("returns null when wallet split fails", async () => {
    const p1 = makeProof(80);
    const p2 = makeProof(50);
    store.set("alice", [p1, p2]);

    const wallet = makeMockWallet({
      sendError: new Error("Mint unreachable"),
    });

    const result = await debitUser(store, "alice", 70, wallet);
    expect(result).toBeNull();
  });
});

describe("createMarketWallet", () => {
  test("creates wallet with fresh store", () => {
    const w = createMarketWallet();
    expect(w.getBalance("alice")).toBe(0);
  });

  test("creates wallet with injected store", () => {
    const store = new Map<string, Proof[]>();
    store.set("alice", [makeProof(500)]);
    const w = createMarketWallet(store);
    expect(w.getBalance("alice")).toBe(500);
  });

  test("credit and getBalance work together", () => {
    const w = createMarketWallet();
    w.credit("bob", [makeProof(100), makeProof(200)]);
    expect(w.getBalance("bob")).toBe(300);
  });

  test("debit delegates to debitUser", async () => {
    const w = createMarketWallet();
    w.credit("alice", [makeProof(100)]);

    const wallet = makeMockWallet();
    const result = await w.debit("alice", 100, wallet);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(w.getBalance("alice")).toBe(0);
  });
});
