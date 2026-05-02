/**
 * PostgreSQL-backed order book for prediction-market FIFO matching.
 *
 * Schema lives in `migrations/001_create_orders.sql` (alongside this file's
 * directory in `example/two-party-binary-bet/migrations/`). Run that file
 * against your Postgres before pointing the server at `DATABASE_URL`.
 *
 * Concurrency model
 * -----------------
 * matchOrders() runs inside a single transaction with `SELECT ... FOR UPDATE`
 * locks on every open order for the market. Concurrent matchers (multiple
 * server processes, or overlapping HTTP requests) serialize on those locks,
 * which is what we want — FIFO matching is not commutative if two matchers
 * race on the same orders.
 *
 * The transaction touches O(open_orders_for_market) rows, not O(all_orders),
 * so the partial index in the migration keeps it fast.
 */

import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { getLogger } from "@anchr/core-runtime/logger";
import type { OpenOrder, MatchProposal } from "./market-types.ts";
import type { OrderBook } from "./order-book.ts";

const log = getLogger(["anchr", "prediction-market", "order-book-pg"]);

interface OrderRow {
  id: string;
  market_id: string;
  bettor_pubkey: string;
  side: "yes" | "no";
  amount_sats: bigint;
  remaining_sats: bigint;
  ts: bigint;
}

function rowToOrder(row: OrderRow): OpenOrder {
  return {
    id: row.id,
    market_id: row.market_id,
    bettor_pubkey: row.bettor_pubkey,
    side: row.side,
    amount_sats: Number(row.amount_sats),
    remaining_sats: Number(row.remaining_sats),
    timestamp: Number(row.ts),
  };
}

export interface PostgresOrderBookOpts {
  /** Postgres connection URL (e.g. `postgres://user:pass@host:5432/db`). */
  connectionUrl: string;
  /** Pool size. Default 10. */
  maxConnections?: number;
}

export interface PostgresOrderBook extends OrderBook {
  /** Close the connection pool. Idempotent. */
  close(): Promise<void>;
}

export async function createPostgresOrderBook(
  opts: PostgresOrderBookOpts,
): Promise<PostgresOrderBook> {
  const sql = postgres(opts.connectionUrl, {
    max: opts.maxConnections ?? 10,
    // postgres-js returns BigInt for BIGINT columns by default, which is what
    // we want — JS Number can't hold 64-bit sats reliably.
  });

  // Smoke-test the connection so misconfiguration fails fast at startup.
  await sql`SELECT 1`;
  log.info("postgres order book connected", {
    maxConnections: opts.maxConnections ?? 10,
  });

  const ob: PostgresOrderBook = {
    async addOrder(order: OpenOrder): Promise<OpenOrder> {
      const remaining = order.remaining_sats ?? order.amount_sats;
      const rows = await sql<OrderRow[]>`
        INSERT INTO prediction_market_orders
          (id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts)
        VALUES
          (${order.id}, ${order.market_id}, ${order.bettor_pubkey}, ${order.side},
           ${order.amount_sats}, ${remaining}, ${order.timestamp})
        RETURNING id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts
      `;
      const row = rows[0];
      if (!row) throw new Error("addOrder: insert returned no row");
      return rowToOrder(row);
    },

    async cancelOrder(id: string): Promise<boolean> {
      const result = await sql`DELETE FROM prediction_market_orders WHERE id = ${id}`;
      return result.count > 0;
    },

    async getOpenOrders(market_id: string, side?: "yes" | "no"): Promise<OpenOrder[]> {
      const rows = side
        ? await sql<OrderRow[]>`
            SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts
            FROM prediction_market_orders
            WHERE market_id = ${market_id}
              AND side = ${side}
              AND remaining_sats > 0
            ORDER BY ts ASC
          `
        : await sql<OrderRow[]>`
            SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts
            FROM prediction_market_orders
            WHERE market_id = ${market_id}
              AND remaining_sats > 0
            ORDER BY ts ASC
          `;
      return rows.map(rowToOrder);
    },

    matchOrders(market_id: string): Promise<MatchProposal[]> {
      // sql.begin runs the callback inside a transaction; tx is a tagged
      // template bound to that transaction. Locks held until commit/rollback.
      return sql.begin(async (tx: TransactionSql<Record<string, never>>): Promise<MatchProposal[]> => {
        const yesRows = await tx<OrderRow[]>`
          SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts
          FROM prediction_market_orders
          WHERE market_id = ${market_id}
            AND side = 'yes'
            AND remaining_sats > 0
          ORDER BY ts ASC
          FOR UPDATE
        `;
        const noRows = await tx<OrderRow[]>`
          SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts
          FROM prediction_market_orders
          WHERE market_id = ${market_id}
            AND side = 'no'
            AND remaining_sats > 0
          ORDER BY ts ASC
          FOR UPDATE
        `;

        const yesOrders = yesRows.map(rowToOrder);
        const noOrders = noRows.map(rowToOrder);

        const proposals: MatchProposal[] = [];
        const changed = new Set<string>();
        let ni = 0;

        for (const yes of yesOrders) {
          while (ni < noOrders.length && yes.remaining_sats > 0) {
            const no = noOrders[ni]!;
            if (no.remaining_sats <= 0) {
              ni++;
              continue;
            }

            const matchAmount = Math.min(yes.remaining_sats, no.remaining_sats);
            proposals.push({
              yes_order_id: yes.id,
              no_order_id: no.id,
              amount_sats: matchAmount,
            });

            yes.remaining_sats -= matchAmount;
            no.remaining_sats -= matchAmount;
            changed.add(yes.id);
            changed.add(no.id);

            if (no.remaining_sats <= 0) ni++;
          }
        }

        // Persist only the orders whose remaining_sats actually changed.
        for (const order of [...yesOrders, ...noOrders]) {
          if (!changed.has(order.id)) continue;
          await tx`
            UPDATE prediction_market_orders
            SET remaining_sats = ${order.remaining_sats}
            WHERE id = ${order.id}
          `;
        }

        return proposals;
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };

  return ob;
}
