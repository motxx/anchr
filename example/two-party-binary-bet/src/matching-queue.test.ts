import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { createInMemoryMatchingQueue } from "./matching-queue.ts";
import type { PendingBet } from "./market-types.ts";

const MARKET_ID = "market-1";

function makeBet(overrides: Partial<PendingBet> = {}): PendingBet {
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

test("enqueue and listPending", async () => {
  const ob = createInMemoryMatchingQueue();
  const bet = makeBet();
  await ob.enqueue(bet);

  const bets = await ob.listPending(MARKET_ID);
  expect(bets.length).toBe(1);
  expect(bets[0]!.id).toBe(bet.id);
});

test("listPending filters by side", async () => {
  const ob = createInMemoryMatchingQueue();
  await ob.enqueue(makeBet({ side: "yes" }));
  await ob.enqueue(makeBet({ side: "no" }));

  expect((await ob.listPending(MARKET_ID, "yes")).length).toBe(1);
  expect((await ob.listPending(MARKET_ID, "no")).length).toBe(1);
});

test("listPending filters by market_id", async () => {
  const ob = createInMemoryMatchingQueue();
  await ob.enqueue(makeBet({ market_id: "m1" }));
  await ob.enqueue(makeBet({ market_id: "m2" }));

  expect((await ob.listPending("m1")).length).toBe(1);
  expect((await ob.listPending("m2")).length).toBe(1);
  expect((await ob.listPending("m3")).length).toBe(0);
});

test("cancel removes the bet", async () => {
  const ob = createInMemoryMatchingQueue();
  const bet = makeBet();
  await ob.enqueue(bet);

  expect(await ob.cancel(bet.id)).toBe(true);
  expect((await ob.listPending(MARKET_ID)).length).toBe(0);

  expect(await ob.cancel("nonexistent")).toBe(false);
});

test("findMatches: equal amounts produce one match", async () => {
  const ob = createInMemoryMatchingQueue();
  const yes = makeBet({ side: "yes", amount_sats: 100, remaining_sats: 100 });
  const no = makeBet({ side: "no", amount_sats: 100, remaining_sats: 100 });
  await ob.enqueue(yes);
  await ob.enqueue(no);

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(100);
  expect(matches[0]!.yes_bet_id).toBe(yes.id);
  expect(matches[0]!.no_bet_id).toBe(no.id);
});

test("findMatches: partial match (100 YES vs 50 NO)", async () => {
  const ob = createInMemoryMatchingQueue();
  const yes = makeBet({ side: "yes", amount_sats: 100, remaining_sats: 100 });
  const no = makeBet({ side: "no", amount_sats: 50, remaining_sats: 50 });
  await ob.enqueue(yes);
  await ob.enqueue(no);

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(50);

  const remaining = await ob.listPending(MARKET_ID, "yes");
  expect(remaining[0]!.remaining_sats).toBe(50);
});

test("findMatches: partial match (50 YES vs 100 NO)", async () => {
  const ob = createInMemoryMatchingQueue();
  const yes = makeBet({ side: "yes", amount_sats: 50, remaining_sats: 50 });
  const no = makeBet({ side: "no", amount_sats: 100, remaining_sats: 100 });
  await ob.enqueue(yes);
  await ob.enqueue(no);

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.amount_sats).toBe(50);

  const remaining = await ob.listPending(MARKET_ID, "no");
  expect(remaining[0]!.remaining_sats).toBe(50);
});

test("findMatches: one side only → no matches", async () => {
  const ob = createInMemoryMatchingQueue();
  await ob.enqueue(makeBet({ side: "yes" }));
  await ob.enqueue(makeBet({ side: "yes" }));

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(0);
});

test("findMatches: FIFO — earliest matched first", async () => {
  const ob = createInMemoryMatchingQueue();
  const now = Math.floor(Date.now() / 1000);

  const yes1 = makeBet({
    side: "yes",
    amount_sats: 50,
    remaining_sats: 50,
    timestamp: now,
  });
  const yes2 = makeBet({
    side: "yes",
    amount_sats: 50,
    remaining_sats: 50,
    timestamp: now + 1,
  });
  const no1 = makeBet({
    side: "no",
    amount_sats: 50,
    remaining_sats: 50,
    timestamp: now,
  });

  await ob.enqueue(yes1);
  await ob.enqueue(yes2);
  await ob.enqueue(no1);

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(1);
  expect(matches[0]!.yes_bet_id).toBe(yes1.id);
});

test("findMatches: multiple matches across bets", async () => {
  const ob = createInMemoryMatchingQueue();
  const now = Math.floor(Date.now() / 1000);

  const yes = makeBet({
    side: "yes",
    amount_sats: 100,
    remaining_sats: 100,
    timestamp: now,
  });
  const no1 = makeBet({
    side: "no",
    amount_sats: 60,
    remaining_sats: 60,
    timestamp: now,
  });
  const no2 = makeBet({
    side: "no",
    amount_sats: 60,
    remaining_sats: 60,
    timestamp: now + 1,
  });

  await ob.enqueue(yes);
  await ob.enqueue(no1);
  await ob.enqueue(no2);

  const matches = await ob.findMatches(MARKET_ID);
  expect(matches.length).toBe(2);
  expect(matches[0]!.amount_sats).toBe(60);
  expect(matches[1]!.amount_sats).toBe(40);
});
