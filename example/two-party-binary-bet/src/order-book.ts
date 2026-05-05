/**
 * Order book interface for two-party-binary-bet FIFO matching.
 *
 * Two implementations:
 *   - createInMemoryOrderBook (this file) — Map-backed, ephemeral; for tests/dev
 *   - SQLite-backed (./kannagi-store.ts:createSqliteOrderBook) — durable
 *
 * Greedy FIFO matching: earliest orders matched first. Partial matches split
 * an order into a matched portion and a remainder (the order stays open with
 * reduced remaining_sats).
 *
 * Both implementations expose the same async interface so the surrounding
 * server-routes / market-api-routes code is storage-agnostic.
 */

import type { OpenOrder, MatchProposal } from "./market-types.ts";

export interface OrderBook {
  /** Add an order. Returns the order with remaining_sats initialized. */
  addOrder(order: OpenOrder): Promise<OpenOrder>;
  /** Cancel an open order. Returns true if found and removed. */
  cancelOrder(id: string): Promise<boolean>;
  /** Get all open orders for a market, optionally filtered by side, FIFO-sorted. */
  getOpenOrders(market_id: string, side?: "yes" | "no"): Promise<OpenOrder[]>;
  /** Run greedy FIFO matching for a market. Returns match proposals. */
  matchOrders(market_id: string): Promise<MatchProposal[]>;
}

export function createInMemoryOrderBook(): OrderBook {
  const orders = new Map<string, OpenOrder>();

  const ob: OrderBook = {
    addOrder(order) {
      const o = { ...order, remaining_sats: order.remaining_sats ?? order.amount_sats };
      orders.set(o.id, o);
      return Promise.resolve(o);
    },

    cancelOrder(id) {
      return Promise.resolve(orders.delete(id));
    },

    getOpenOrders(market_id, side) {
      const result: OpenOrder[] = [];
      for (const o of orders.values()) {
        if (o.market_id !== market_id) continue;
        if (o.remaining_sats <= 0) continue;
        if (side && o.side !== side) continue;
        result.push(o);
      }
      result.sort((a, b) => a.timestamp - b.timestamp);
      return Promise.resolve(result);
    },

    async matchOrders(market_id) {
      const yesOrders = await ob.getOpenOrders(market_id, "yes");
      const noOrders = await ob.getOpenOrders(market_id, "no");

      const proposals: MatchProposal[] = [];
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

          // In-memory: yes/no are the same references stored in the Map,
          // so this mutation persists for subsequent getOpenOrders calls.
          yes.remaining_sats -= matchAmount;
          no.remaining_sats -= matchAmount;

          if (no.remaining_sats <= 0) ni++;
        }
      }

      return proposals;
    },
  };

  return ob;
}
