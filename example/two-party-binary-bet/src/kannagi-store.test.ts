/**
 * Unit tests for the SQLite-backed Kannagi store.
 *
 * Uses an in-memory database (`:memory:`) so tests run without filesystem
 * side effects. The store and its order-book share one connection, so we
 * also exercise the order-book contract here rather than carrying a
 * separate Postgres-flavoured e2e suite.
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { openKannagiStore } from "./kannagi-store.ts";
import type { MatchedBetPair, OpenOrder, TwoPartyBinaryBet } from "./market-types.ts";

function freshMarket(id: string): TwoPartyBinaryBet {
  return {
    id,
    title: "Will it rain tomorrow?",
    description: "test market",
    category: "custom",
    creator_pubkey: "abcd".repeat(16),
    resolution_url: "https://example.com/weather",
    resolution_condition: {
      type: "contains_text",
      target_url: "https://example.com/weather",
      expected_text: "rain",
      description: "rain in body",
    },
    resolution_deadline: 1735689600,
    yes_pool_sats: 0,
    no_pool_sats: 0,
    min_bet_sats: 1,
    max_bet_sats: 0,
    fee_ppm: 0,
    oracle_pubkey: "ef".repeat(32),
    htlc_hash_yes: "11".repeat(32),
    htlc_hash_no: "22".repeat(32),
    nostr_event_id: "eeee".repeat(16),
    status: "open",
  };
}

function freshOrder(id: string, market_id: string, side: "yes" | "no", amount: number, ts: number): OpenOrder {
  return {
    id,
    market_id,
    bettor_pubkey: side === "yes" ? "11".repeat(32) : "22".repeat(32),
    side,
    amount_sats: amount,
    remaining_sats: amount,
    timestamp: ts,
  };
}

describe("kannagi store: schema bootstrap", () => {
  it("opens an empty :memory: DB and hydrates an empty state", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    const state = await store.hydrate();
    expect(state.markets.size).toBe(0);
    expect(state.matchedPairs.size).toBe(0);
    expect(state.resolvedPreimages.size).toBe(0);
    expect(state.resolvedSignatures.size).toBe(0);
    expect(state.resolvedProofSignatures.size).toBe(0);
    expect(state.pendingExchangeTokens.size).toBe(0);
    await store.close();
  });
});

describe("kannagi store: persist + hydrate round-trip", () => {
  it("survives close + reopen for a file-backed DB", async () => {
    const tmp = await Deno.makeTempFile({ prefix: "kannagi-", suffix: ".db" });
    try {
      const m = freshMarket("market-1");
      const pair: MatchedBetPair = {
        pair_id: "pair-1",
        market_id: "market-1",
        yes_pubkey: "11".repeat(32),
        no_pubkey: "22".repeat(32),
        amount_sats: 5000,
        token_yes_to_no: "cashuB-yes-to-no",
        token_no_to_yes: "cashuB-no-to-yes",
        status: "locked",
      };

      const w = openKannagiStore({ path: tmp });
      await w.persist.market(m);
      await w.persist.pair(pair);
      await w.persist.preimage("market-1", "cafe".repeat(16));
      await w.persist.signature("market-1", "deadbeef".repeat(8));
      await w.persist.proofSignatures("market-1", new Map([["secret-a", "sig-a"], ["secret-b", "sig-b"]]));
      await w.persist.pendingExchangeToken("pair-1", "yes", "cashuB-yes");
      await w.close();

      const r = openKannagiStore({ path: tmp });
      const state = await r.hydrate();

      expect(state.markets.get("market-1")).toEqual(m);
      expect(state.matchedPairs.get("pair-1")).toEqual(pair);
      expect(state.resolvedPreimages.get("market-1")).toBe("cafe".repeat(16));
      expect(state.resolvedSignatures.get("market-1")).toBe("deadbeef".repeat(8));
      expect(state.resolvedProofSignatures.get("market-1")?.get("secret-a")).toBe("sig-a");
      expect(state.resolvedProofSignatures.get("market-1")?.get("secret-b")).toBe("sig-b");
      expect(state.pendingExchangeTokens.get("pair-1_yes")).toBe("cashuB-yes");
      await r.close();
    } finally {
      await Deno.remove(tmp).catch(() => {});
    }
  });

  it("market upsert reflects status changes", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    const m = freshMarket("m");
    await store.persist.market(m);

    m.status = "resolved_yes";
    await store.persist.market(m);

    const state = await store.hydrate();
    expect(state.markets.get("m")?.status).toBe("resolved_yes");
    await store.close();
  });

  it("proof signatures merge new entries without dropping old ones", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.persist.proofSignatures("m", new Map([["a", "sig-a"]]));
    await store.persist.proofSignatures("m", new Map([["b", "sig-b"]]));

    const state = await store.hydrate();
    const inner = state.resolvedProofSignatures.get("m")!;
    expect(inner.size).toBe(2);
    expect(inner.get("a")).toBe("sig-a");
    expect(inner.get("b")).toBe("sig-b");
    await store.close();
  });

  it("delete pending exchange token removes the row", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.persist.pendingExchangeToken("p", "yes", "tok-y");
    await store.persist.pendingExchangeToken("p", "no", "tok-n");
    await store.persist.deletePendingExchangeToken("p", "yes");

    const state = await store.hydrate();
    expect(state.pendingExchangeTokens.get("p_yes")).toBeUndefined();
    expect(state.pendingExchangeTokens.get("p_no")).toBe("tok-n");
    await store.close();
  });
});

describe("kannagi store: SQLite order book", () => {
  it("addOrder + getOpenOrders FIFO", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1000, 1));
    await store.orderBook.addOrder(freshOrder("y2", "m", "yes", 500, 2));
    await store.orderBook.addOrder(freshOrder("n1", "m", "no", 1000, 3));

    const yes = await store.orderBook.getOpenOrders("m", "yes");
    expect(yes.map((o) => o.id)).toEqual(["y1", "y2"]);

    const all = await store.orderBook.getOpenOrders("m");
    expect(all.map((o) => o.id)).toEqual(["y1", "y2", "n1"]);
    await store.close();
  });

  it("matchOrders: equal YES/NO produces one full match and zeros remaining_sats", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1000, 1));
    await store.orderBook.addOrder(freshOrder("n1", "m", "no", 1000, 2));

    const proposals = await store.orderBook.matchOrders("m");
    expect(proposals).toEqual([{ yes_order_id: "y1", no_order_id: "n1", amount_sats: 1000 }]);

    const open = await store.orderBook.getOpenOrders("m");
    expect(open).toEqual([]);
    await store.close();
  });

  it("matchOrders: partial match leaves the remainder open", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1500, 1));
    await store.orderBook.addOrder(freshOrder("n1", "m", "no", 1000, 2));

    const proposals = await store.orderBook.matchOrders("m");
    expect(proposals).toEqual([{ yes_order_id: "y1", no_order_id: "n1", amount_sats: 1000 }]);

    const open = await store.orderBook.getOpenOrders("m");
    expect(open.map((o) => ({ id: o.id, remaining: o.remaining_sats }))).toEqual([
      { id: "y1", remaining: 500 },
    ]);
    await store.close();
  });

  it("matchOrders: FIFO across multiple NO orders", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1500, 1));
    await store.orderBook.addOrder(freshOrder("n1", "m", "no", 600, 2));
    await store.orderBook.addOrder(freshOrder("n2", "m", "no", 400, 3));
    await store.orderBook.addOrder(freshOrder("n3", "m", "no", 800, 4));

    const proposals = await store.orderBook.matchOrders("m");
    expect(proposals).toEqual([
      { yes_order_id: "y1", no_order_id: "n1", amount_sats: 600 },
      { yes_order_id: "y1", no_order_id: "n2", amount_sats: 400 },
      { yes_order_id: "y1", no_order_id: "n3", amount_sats: 500 },
    ]);

    const open = await store.orderBook.getOpenOrders("m");
    expect(open.map((o) => ({ id: o.id, remaining: o.remaining_sats }))).toEqual([
      { id: "n3", remaining: 300 },
    ]);
    await store.close();
  });

  it("matchOrders: idempotent — re-running on already-matched book produces no proposals", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1000, 1));
    await store.orderBook.addOrder(freshOrder("n1", "m", "no", 1000, 2));
    await store.orderBook.matchOrders("m");

    const proposals = await store.orderBook.matchOrders("m");
    expect(proposals).toEqual([]);
    await store.close();
  });

  it("cancelOrder removes the row", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m", "yes", 1000, 1));
    expect(await store.orderBook.cancelOrder("y1")).toBe(true);
    expect(await store.orderBook.cancelOrder("y1")).toBe(false);
    expect(await store.orderBook.getOpenOrders("m")).toEqual([]);
    await store.close();
  });

  it("getOpenOrders filters by side and market_id", async () => {
    const store = openKannagiStore({ path: ":memory:" });
    await store.orderBook.addOrder(freshOrder("y1", "m1", "yes", 1000, 1));
    await store.orderBook.addOrder(freshOrder("n1", "m2", "no", 1000, 2));

    expect((await store.orderBook.getOpenOrders("m1", "yes")).map((o) => o.id)).toEqual(["y1"]);
    expect((await store.orderBook.getOpenOrders("m1", "no")).map((o) => o.id)).toEqual([]);
    expect((await store.orderBook.getOpenOrders("m2")).map((o) => o.id)).toEqual(["n1"]);
    await store.close();
  });
});
