/**
 * In-memory order book for prediction market matching.
 *
 * Greedy FIFO matching: earliest orders matched first.
 * Partial matches split an order into a matched portion and a remainder.
 */

import type { OpenOrder, MatchProposal } from "./market-types.ts";

export interface OrderBook {
  /** Add an order. Returns the order with remaining_sats initialized. */
  addOrder(order: OpenOrder): OpenOrder;
  /** Cancel an open order. Returns true if found and removed. */
  cancelOrder(id: string): boolean;
  /** Get all open orders for a market, optionally filtered by side. */
  getOpenOrders(market_id: string, side?: "yes" | "no"): OpenOrder[];
  /** Run greedy FIFO matching for a market. Returns match proposals. */
  matchOrders(market_id: string): MatchProposal[];
}

export function createOrderBook(): OrderBook {
  const orders = new Map<string, OpenOrder>();

  return {
    addOrder(order: OpenOrder): OpenOrder {
      const o = { ...order, remaining_sats: order.remaining_sats ?? order.amount_sats };
      orders.set(o.id, o);
      return o;
    },

    cancelOrder(id: string): boolean {
      return orders.delete(id);
    },

    getOpenOrders(market_id: string, side?: "yes" | "no"): OpenOrder[] {
      const result: OpenOrder[] = [];
      for (const o of orders.values()) {
        if (o.market_id !== market_id) continue;
        if (o.remaining_sats <= 0) continue;
        if (side && o.side !== side) continue;
        result.push(o);
      }
      // FIFO: sort by timestamp ascending
      return result.sort((a, b) => a.timestamp - b.timestamp);
    },

    matchOrders(market_id: string): MatchProposal[] {
      const yesOrders = this.getOpenOrders(market_id, "yes");
      const noOrders = this.getOpenOrders(market_id, "no");

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

          yes.remaining_sats -= matchAmount;
          no.remaining_sats -= matchAmount;

          if (no.remaining_sats <= 0) ni++;
        }
      }

      return proposals;
    },
  };
}
