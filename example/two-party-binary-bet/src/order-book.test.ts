import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { createInMemoryOrderBook } from "./order-book.ts";
import type { OpenOrder } from "./market-types.ts";

const MARKET_ID = "market-1";

function makeOrder(overrides: Partial<OpenOrder> = {}): OpenOrder {
  return {
    id: bytesToHex(randomBytes(16)),
    market_id: MARKET_ID,
    bettor_pubkey: bytesToHex(randomBytes(32)),
    side: "yes",
    amount_sats: 100,
    remaining_sats: 100,
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

test("addOrder and getOpenOrders", async () => {
  const ob = createInMemoryOrderBook();
  const order = makeOrder();
  await ob.addOrder(order);

  const orders = await ob.getOpenOrders(MARKET_ID);
  expect(orders.length).toBe(1);
  expect(orders[0]!.id).toBe(order.id);
});

test("getOpenOrders filters by side", async () => {
  const ob = createInMemoryOrderBook();
  await ob.addOrder(makeOrder({ side: "yes" }));
  await ob.addOrder(makeOrder({ side: "no" }));

  expect((await ob.getOpenOrders(MARKET_ID, "yes")).length).toBe(1);
  expect((await ob.getOpenOrders(MARKET_ID, "no")).length).toBe(1);
});

test("getOpenOrders filters by market_id", async () => {
  const ob = createInMemoryOrderBook();
  await ob.addOrder(makeOrder({ market_id: "m1" }));
  await ob.addOrder(makeOrder({ market_id: "m2" }));

  expect((await ob.getOpenOrders("m1")).length).toBe(1);
  expect((await ob.getOpenOrders("m2")).length).toBe(1);
  expect((await ob.getOpenOrders("m3")).length).toBe(0);
});

test("cancelOrder removes the order", async () => {
  const ob = createInMemoryOrderBook();
  const order = makeOrder();
  await ob.addOrder(order);

  expect(await ob.cancelOrder(order.id)).toBe(true);
  expect((await ob.getOpenOrders(MARKET_ID)).length).toBe(0);

  expect(await ob.cancelOrder("nonexistent")).toBe(false);
});

test("matchOrders: equal amounts produce one match", async () => {
  const ob = createInMemoryOrderBook();
  const yes = makeOrder({ side: "yes", amount_sats: 100, remaining_sats: 100 });
  const no = makeOrder({ side: "no", amount_sats: 100, remaining_sats: 100 });
  await ob.addOrder(yes);
  await ob.addOrder(no);

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(100);
  expect(matches[0]!.yes_order_id).toBe(yes.id);
  expect(matches[0]!.no_order_id).toBe(no.id);
});

test("matchOrders: partial match (100 YES vs 50 NO)", async () => {
  const ob = createInMemoryOrderBook();
  const yes = makeOrder({ side: "yes", amount_sats: 100, remaining_sats: 100 });
  const no = makeOrder({ side: "no", amount_sats: 50, remaining_sats: 50 });
  await ob.addOrder(yes);
  await ob.addOrder(no);

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(50);

  const remaining = await ob.getOpenOrders(MARKET_ID, "yes");
  expect(remaining[0]!.remaining_sats).toBe(50);
});

test("matchOrders: partial match (50 YES vs 100 NO)", async () => {
  const ob = createInMemoryOrderBook();
  const yes = makeOrder({ side: "yes", amount_sats: 50, remaining_sats: 50 });
  const no = makeOrder({ side: "no", amount_sats: 100, remaining_sats: 100 });
  await ob.addOrder(yes);
  await ob.addOrder(no);

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(50);

  const remaining = await ob.getOpenOrders(MARKET_ID, "no");
  expect(remaining[0]!.remaining_sats).toBe(50);
});

test("matchOrders: one side only → no matches", async () => {
  const ob = createInMemoryOrderBook();
  await ob.addOrder(makeOrder({ side: "yes" }));
  await ob.addOrder(makeOrder({ side: "yes" }));

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(0);
});

test("matchOrders: FIFO order — earliest matched first", async () => {
  const ob = createInMemoryOrderBook();
  const now = Math.floor(Date.now() / 1000);

  const yes1 = makeOrder({ side: "yes", amount_sats: 50, remaining_sats: 50, timestamp: now });
  const yes2 = makeOrder({ side: "yes", amount_sats: 50, remaining_sats: 50, timestamp: now + 1 });
  const no1 = makeOrder({ side: "no", amount_sats: 50, remaining_sats: 50, timestamp: now });

  await ob.addOrder(yes1);
  await ob.addOrder(yes2);
  await ob.addOrder(no1);

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.yes_order_id).toBe(yes1.id);
});

test("matchOrders: multiple matches across orders", async () => {
  const ob = createInMemoryOrderBook();
  const now = Math.floor(Date.now() / 1000);

  const yes = makeOrder({ side: "yes", amount_sats: 100, remaining_sats: 100, timestamp: now });
  const no1 = makeOrder({ side: "no", amount_sats: 60, remaining_sats: 60, timestamp: now });
  const no2 = makeOrder({ side: "no", amount_sats: 60, remaining_sats: 60, timestamp: now + 1 });

  await ob.addOrder(yes);
  await ob.addOrder(no1);
  await ob.addOrder(no2);

  const matches = await ob.matchOrders(MARKET_ID);
  expect(matches.length).toBe(2);
  expect(matches[0]!.amount_sats).toBe(60);
  expect(matches[1]!.amount_sats).toBe(40);
});
