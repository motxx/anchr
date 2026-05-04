/**
 * E2E: Postgres-backed order book.
 *
 * Exercises createPostgresOrderBook against a real Postgres instance —
 * the production storage path. The in-memory implementation is covered
 * by the unit tests under example/two-party-binary-bet/src/order-book.test.ts;
 * this file proves the SQL paths (insert, partial-index scan, transactional
 * matching with FOR UPDATE locks) actually behave the same way.
 *
 * Skipped automatically when DATABASE_URL is unset or unreachable.
 *
 * Run:
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://anchr:anchr@localhost:5432/anchr_market \
 *     deno test e2e/prediction-market-orderbook-pg.test.ts --allow-all
 */

import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import postgres from "postgres";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

import {
  createPostgresOrderBook,
  type PostgresOrderBook,
} from "../example/two-party-binary-bet/src/order-book-postgres.ts";
import type { OpenOrder } from "../example/two-party-binary-bet/src/market-types.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");

async function isPostgresReady(url: string): Promise<boolean> {
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = postgres(url, { max: 1, idle_timeout: 1 });
    await sql`SELECT 1`;
    return true;
  } catch (err) {
    console.warn(
      `[e2e] Postgres not reachable at ${url} — order-book PG tests will be ignored. ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
    console.warn("  Run: docker compose up -d postgres");
    return false;
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
}

const READY = DATABASE_URL ? await isPostgresReady(DATABASE_URL) : false;
const suite = READY ? describe : describe.ignore;

// Fresh market_id per test isolates state on a shared table — concurrent CI
// runs against the same DB still pass because matching is scoped by market.
function freshMarketId(): string {
  return `mkt_${bytesToHex(randomBytes(8))}`;
}

function makeOrder(marketId: string, overrides: Partial<OpenOrder> = {}): OpenOrder {
  return {
    id: `ord_${bytesToHex(randomBytes(8))}`,
    market_id: marketId,
    bettor_pubkey: bytesToHex(randomBytes(32)),
    side: "yes",
    amount_sats: 100,
    remaining_sats: 100,
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

suite("e2e: Postgres order book", () => {
  let ob: PostgresOrderBook;

  beforeAll(async () => {
    ob = await createPostgresOrderBook({ connectionUrl: DATABASE_URL! });
  });

  afterAll(async () => {
    await ob.close();
  });

  test("addOrder persists and getOpenOrders returns it", async () => {
    const marketId = freshMarketId();
    const order = makeOrder(marketId);
    const stored = await ob.addOrder(order);

    expect(stored.id).toBe(order.id);
    expect(stored.remaining_sats).toBe(order.amount_sats);

    const open = await ob.getOpenOrders(marketId);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(order.id);
  });

  test("getOpenOrders filters by side and market_id", async () => {
    const m1 = freshMarketId();
    const m2 = freshMarketId();

    await ob.addOrder(makeOrder(m1, { side: "yes" }));
    await ob.addOrder(makeOrder(m1, { side: "no" }));
    await ob.addOrder(makeOrder(m2, { side: "yes" }));

    expect((await ob.getOpenOrders(m1, "yes"))).toHaveLength(1);
    expect((await ob.getOpenOrders(m1, "no"))).toHaveLength(1);
    expect((await ob.getOpenOrders(m1))).toHaveLength(2);
    expect((await ob.getOpenOrders(m2))).toHaveLength(1);
  });

  test("cancelOrder removes the row", async () => {
    const marketId = freshMarketId();
    const order = makeOrder(marketId);
    await ob.addOrder(order);

    expect(await ob.cancelOrder(order.id)).toBe(true);
    expect(await ob.cancelOrder(order.id)).toBe(false);
    expect(await ob.getOpenOrders(marketId)).toHaveLength(0);
  });

  test("matchOrders: equal YES/NO produces one full match and zeros remaining_sats", async () => {
    const marketId = freshMarketId();
    const yes = makeOrder(marketId, { side: "yes", amount_sats: 100, remaining_sats: 100 });
    const no = makeOrder(marketId, { side: "no", amount_sats: 100, remaining_sats: 100 });
    await ob.addOrder(yes);
    await ob.addOrder(no);

    const proposals = await ob.matchOrders(marketId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.amount_sats).toBe(100);
    expect(proposals[0]!.yes_order_id).toBe(yes.id);
    expect(proposals[0]!.no_order_id).toBe(no.id);

    // After matching, remaining_sats must be persisted to 0 — that's the
    // partial-index gate that excludes them from getOpenOrders.
    expect(await ob.getOpenOrders(marketId)).toHaveLength(0);
  });

  test("matchOrders: partial match leaves the remainder open", async () => {
    const marketId = freshMarketId();
    const yes = makeOrder(marketId, { side: "yes", amount_sats: 100, remaining_sats: 100 });
    const no = makeOrder(marketId, { side: "no", amount_sats: 40, remaining_sats: 40 });
    await ob.addOrder(yes);
    await ob.addOrder(no);

    const proposals = await ob.matchOrders(marketId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.amount_sats).toBe(40);

    const remaining = await ob.getOpenOrders(marketId, "yes");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(yes.id);
    expect(remaining[0]!.remaining_sats).toBe(60);
    expect(await ob.getOpenOrders(marketId, "no")).toHaveLength(0);
  });

  test("matchOrders: FIFO across multiple NO orders", async () => {
    const marketId = freshMarketId();
    const now = Math.floor(Date.now() / 1000);

    const yes = makeOrder(marketId, { side: "yes", amount_sats: 100, remaining_sats: 100, timestamp: now });
    const no1 = makeOrder(marketId, { side: "no", amount_sats: 60, remaining_sats: 60, timestamp: now });
    const no2 = makeOrder(marketId, { side: "no", amount_sats: 60, remaining_sats: 60, timestamp: now + 1 });
    await ob.addOrder(yes);
    await ob.addOrder(no1);
    await ob.addOrder(no2);

    const proposals = await ob.matchOrders(marketId);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]!.no_order_id).toBe(no1.id); // earliest first
    expect(proposals[0]!.amount_sats).toBe(60);
    expect(proposals[1]!.no_order_id).toBe(no2.id);
    expect(proposals[1]!.amount_sats).toBe(40); // YES side ran out

    // YES fully consumed, no2 has 20 sats left
    expect(await ob.getOpenOrders(marketId, "yes")).toHaveLength(0);
    const noLeft = await ob.getOpenOrders(marketId, "no");
    expect(noLeft).toHaveLength(1);
    expect(noLeft[0]!.id).toBe(no2.id);
    expect(noLeft[0]!.remaining_sats).toBe(20);
  });

  test("matchOrders: idempotent — re-running on already-matched book produces no proposals", async () => {
    const marketId = freshMarketId();
    await ob.addOrder(makeOrder(marketId, { side: "yes", amount_sats: 50, remaining_sats: 50 }));
    await ob.addOrder(makeOrder(marketId, { side: "no", amount_sats: 50, remaining_sats: 50 }));

    expect(await ob.matchOrders(marketId)).toHaveLength(1);
    // Second call sees no remaining_sats > 0 rows -> no proposals.
    expect(await ob.matchOrders(marketId)).toHaveLength(0);
  });

  test("matchOrders: concurrent matchers serialize via SELECT FOR UPDATE", async () => {
    // Two matchers fire matchOrders() simultaneously on the same market.
    // The transaction's FOR UPDATE locks force serialization: the second
    // matcher sees the first's UPDATE committed, so the totals stay
    // consistent (no double-matching the same remaining_sats).
    const marketId = freshMarketId();
    const yes = makeOrder(marketId, { side: "yes", amount_sats: 100, remaining_sats: 100 });
    const no = makeOrder(marketId, { side: "no", amount_sats: 100, remaining_sats: 100 });
    await ob.addOrder(yes);
    await ob.addOrder(no);

    const [a, b] = await Promise.all([
      ob.matchOrders(marketId),
      ob.matchOrders(marketId),
    ]);

    // Exactly one of the two calls must see the unmatched book and produce
    // the proposal; the other must see the committed UPDATE and find nothing.
    const totalProposals = a.length + b.length;
    expect(totalProposals).toBe(1);

    // And the order rows must be fully drained — never matched twice.
    expect(await ob.getOpenOrders(marketId)).toHaveLength(0);
  });
});
