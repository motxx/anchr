import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createWalletStore, type WalletStore } from "./wallet-store.ts";
import type { Proof } from "@cashu/cashu-ts";

function fakeProof(amount: number, secret?: string): Proof {
  return {
    amount,
    id: "test",
    secret: secret ?? `s_${amount}_${Math.random()}`,
    C: "C",
  } as Proof;
}

describe("WalletStore", () => {
  let store: WalletStore;

  beforeEach(() => {
    store = createWalletStore();
  });

  describe("addProofs + getBalance", () => {
    test("empty wallet has zero balance", () => {
      const bal = store.getBalance("provider", "pk1");
      expect(bal.balance_sats).toBe(0);
      expect(bal.pending_sats).toBe(0);
    });

    test("addProofs increases confirmed balance", () => {
      store.addProofs("provider", "pk1", [fakeProof(10), fakeProof(20)]);
      const bal = store.getBalance("provider", "pk1");
      expect(bal.balance_sats).toBe(30);
      expect(bal.pending_sats).toBe(0);
    });

    test("different role/pubkey combos are isolated", () => {
      store.addProofs("provider", "pk1", [fakeProof(10)]);
      store.addProofs("customer", "pk1", [fakeProof(50)]);
      store.addProofs("provider", "pk2", [fakeProof(100)]);

      expect(store.getBalance("provider", "pk1").balance_sats).toBe(10);
      expect(store.getBalance("customer", "pk1").balance_sats).toBe(50);
      expect(store.getBalance("provider", "pk2").balance_sats).toBe(100);
    });
  });

  describe("lockForQuery", () => {
    test("locks proofs and moves them to pending", () => {
      store.addProofs("customer", "pk1", [
        fakeProof(10),
        fakeProof(20),
        fakeProof(5),
      ]);
      const locked = store.lockForQuery("customer", "pk1", "q1", 15);

      expect(locked).not.toBeNull();
      expect(locked!.reduce((s, p) => s + p.amount, 0)).toBeGreaterThanOrEqual(
        15,
      );

      const bal = store.getBalance("customer", "pk1");
      expect(bal.pending_sats).toBeGreaterThanOrEqual(15);
      expect(bal.balance_sats + bal.pending_sats).toBe(35);
    });

    test("returns null when insufficient balance", () => {
      store.addProofs("customer", "pk1", [fakeProof(5)]);
      const locked = store.lockForQuery("customer", "pk1", "q1", 100);
      expect(locked).toBeNull();
      expect(store.getBalance("customer", "pk1").balance_sats).toBe(5);
    });

    test("selects largest-first (greedy)", () => {
      store.addProofs("customer", "pk1", [
        fakeProof(1, "s1"),
        fakeProof(8, "s8"),
        fakeProof(4, "s4"),
        fakeProof(16, "s16"),
      ]);
      const locked = store.lockForQuery("customer", "pk1", "q1", 10);
      expect(locked).not.toBeNull();
      expect(locked!.length).toBe(1);
      expect(locked![0].amount).toBe(16);
    });

    test("getLockedProofs returns locked proofs for query", () => {
      const p1 = fakeProof(10, "a");
      const p2 = fakeProof(20, "b");
      store.addProofs("provider", "pk1", [p1, p2]);
      store.lockForQuery("provider", "pk1", "q1", 10);

      const locked = store.getLockedProofs("provider", "pk1", "q1");
      expect(locked.length).toBeGreaterThan(0);

      const empty = store.getLockedProofs("provider", "pk1", "nonexistent");
      expect(empty.length).toBe(0);
    });
  });

  describe("unlockForQuery", () => {
    test("returns locked proofs to confirmed balance", () => {
      store.addProofs("customer", "pk1", [fakeProof(50)]);
      store.lockForQuery("customer", "pk1", "q1", 50);

      expect(store.getBalance("customer", "pk1").balance_sats).toBe(0);
      expect(store.getBalance("customer", "pk1").pending_sats).toBe(50);

      store.unlockForQuery("customer", "pk1", "q1");

      expect(store.getBalance("customer", "pk1").balance_sats).toBe(50);
      expect(store.getBalance("customer", "pk1").pending_sats).toBe(0);
    });

    test("no-op for non-existent query", () => {
      store.addProofs("customer", "pk1", [fakeProof(10)]);
      store.unlockForQuery("customer", "pk1", "q_nonexistent");
      expect(store.getBalance("customer", "pk1").balance_sats).toBe(10);
    });
  });

  describe("transferLocked", () => {
    test("moves locked proofs from one wallet to another", () => {
      store.addProofs("customer", "pkR", [fakeProof(100)]);
      store.lockForQuery("customer", "pkR", "q1", 100);

      expect(store.getBalance("customer", "pkR").balance_sats).toBe(0);
      expect(store.getBalance("provider", "pkW").balance_sats).toBe(0);

      store.transferLocked("customer", "pkR", "q1", "provider", "pkW");

      expect(store.getBalance("customer", "pkR").pending_sats).toBe(0);
      expect(store.getBalance("provider", "pkW").balance_sats).toBe(100);
    });

    test("no-op if query has no locked proofs", () => {
      store.transferLocked("customer", "pkR", "q_missing", "provider", "pkW");
      expect(store.getBalance("provider", "pkW").balance_sats).toBe(0);
    });
  });

  describe("withLock", () => {
    test("serializes concurrent operations on same wallet", async () => {
      store.addProofs("provider", "pk1", [fakeProof(100)]);
      const order: number[] = [];

      const p1 = store.withLock("provider", "pk1", async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        order.push(2);
      });

      const p2 = store.withLock("provider", "pk1", async () => {
        order.push(3);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2, 3]);
    });

    test("different wallets can run in parallel", async () => {
      const order: string[] = [];

      const p1 = store.withLock("provider", "pk1", async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 50));
        order.push("a-end");
      });

      const p2 = store.withLock("provider", "pk2", async () => {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("b-end");
      });

      await Promise.all([p1, p2]);
      expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));
    });

    test("returns the value from the function", async () => {
      const result = await store.withLock("provider", "pk1", () => 42);
      expect(result).toBe(42);
    });
  });
});
