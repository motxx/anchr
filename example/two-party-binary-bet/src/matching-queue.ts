/**
 * Matching queue interface for two-party-binary-bet FIFO matching.
 *
 * Two implementations:
 *   - createInMemoryMatchingQueue (this file) — Map-backed, ephemeral; for tests/dev
 *   - SQLite-backed (./market-store.ts:createSqliteMatchingQueue) — durable
 *
 * Greedy FIFO matching: earliest bets matched first. Partial matches split
 * a bet into a matched portion and a remainder (the bet stays pending with
 * reduced remaining_sats).
 *
 * Both implementations expose the same async interface so the surrounding
 * server-routes / market-api-routes code is storage-agnostic.
 */

import type { PendingBet, MatchProposal } from "./market-types.ts";

export interface MatchingQueue {
  /** Add a pending bet. Returns the bet with remaining_sats initialized. */
  enqueue(bet: PendingBet): Promise<PendingBet>;
  /** Cancel a pending bet. Returns true if found and removed. */
  cancel(id: string): Promise<boolean>;
  /** Get all pending bets for a market, optionally filtered by side, FIFO-sorted. */
  listPending(market_id: string, side?: "yes" | "no"): Promise<PendingBet[]>;
  /** Run greedy FIFO matching for a market. Returns match proposals. */
  findMatches(market_id: string): Promise<MatchProposal[]>;
}

export function createInMemoryMatchingQueue(): MatchingQueue {
  const bets = new Map<string, PendingBet>();

  const queue: MatchingQueue = {
    enqueue(bet) {
      const initialised = { ...bet, remaining_sats: bet.remaining_sats ?? bet.amount_sats };
      bets.set(initialised.id, initialised);
      return Promise.resolve(initialised);
    },

    cancel(id) {
      return Promise.resolve(bets.delete(id));
    },

    listPending(market_id, side) {
      const result: PendingBet[] = [];
      for (const bet of bets.values()) {
        if (bet.market_id !== market_id) continue;
        if (bet.remaining_sats <= 0) continue;
        if (side && bet.side !== side) continue;
        result.push(bet);
      }
      result.sort((a, b) => a.timestamp - b.timestamp);
      return Promise.resolve(result);
    },

    async findMatches(market_id) {
      const yesBets = await queue.listPending(market_id, "yes");
      const noBets = await queue.listPending(market_id, "no");

      const proposals: MatchProposal[] = [];
      let ni = 0;

      for (const yes of yesBets) {
        while (ni < noBets.length && yes.remaining_sats > 0) {
          const no = noBets[ni]!;
          if (no.remaining_sats <= 0) {
            ni++;
            continue;
          }

          const matchAmount = Math.min(yes.remaining_sats, no.remaining_sats);
          proposals.push({
            yes_bet_id: yes.id,
            no_bet_id: no.id,
            amount_sats: matchAmount,
          });

          // In-memory: yes/no are the same references stored in the Map,
          // so this mutation persists for subsequent listPending calls.
          yes.remaining_sats -= matchAmount;
          no.remaining_sats -= matchAmount;

          if (no.remaining_sats <= 0) ni++;
        }
      }

      return proposals;
    },
  };

  return queue;
}
