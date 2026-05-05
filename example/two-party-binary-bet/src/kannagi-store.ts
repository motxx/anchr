/**
 * SQLite-backed persistence for the 巫(Kannagi) two-party-binary-bet server.
 *
 * Owns one DB file containing the order book (durable orders + FIFO matching)
 * plus the six runtime maps so a Fly machine restart recovers full state:
 *
 *   - markets                 (TwoPartyBinaryBet, JSON blob keyed by market_id)
 *   - matched_pairs           (MatchedBetPair,    JSON blob keyed by pair_id)
 *   - resolved_preimages      (one preimage per market)
 *   - resolved_signatures     (one Schnorr signature per market)
 *   - resolved_proof_signatures (per-Cashu-proof signatures, denormalised)
 *   - pending_exchange_tokens (transient cashuB tokens during pair exchange)
 *
 * Concurrency: a single Fly machine, single Deno process. SQLite WAL gives
 * us concurrent readers + one writer, which matches our load profile (the
 * matcher and auto-resolver run in-process, no horizontal scaling).
 */

import { Database } from "@db/sqlite";
import { getLogger } from "@anchr/core-runtime/logger";
import type { OrderBook } from "./order-book.ts";
import type {
  MatchProposal,
  MatchedBetPair,
  OpenOrder,
  TwoPartyBinaryBet,
} from "./market-types.ts";

const log = getLogger(["anchr", "two-party-binary-bet", "kannagi-store"]);

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  market_id       TEXT NOT NULL,
  bettor_pubkey   TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  amount_sats     INTEGER NOT NULL CHECK (amount_sats > 0),
  remaining_sats  INTEGER NOT NULL CHECK (remaining_sats >= 0),
  ts              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_open_fifo
  ON orders (market_id, side, ts)
  WHERE remaining_sats > 0;

CREATE TABLE IF NOT EXISTS markets (
  id   TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matched_pairs (
  pair_id   TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matched_pairs_market ON matched_pairs(market_id);

CREATE TABLE IF NOT EXISTS resolved_preimages (
  market_id TEXT PRIMARY KEY,
  preimage  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolved_signatures (
  market_id TEXT PRIMARY KEY,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolved_proof_signatures (
  market_id    TEXT NOT NULL,
  proof_secret TEXT NOT NULL,
  signature    TEXT NOT NULL,
  PRIMARY KEY (market_id, proof_secret)
);

CREATE TABLE IF NOT EXISTS pending_exchange_tokens (
  pair_id TEXT NOT NULL,
  side    TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  token   TEXT NOT NULL,
  PRIMARY KEY (pair_id, side)
);
`;

export interface HydratedState {
  markets: Map<string, TwoPartyBinaryBet>;
  matchedPairs: Map<string, MatchedBetPair>;
  resolvedPreimages: Map<string, string>;
  resolvedSignatures: Map<string, string>;
  resolvedProofSignatures: Map<string, Map<string, string>>;
  pendingExchangeTokens: Map<string, string>;
}

export interface KannagiPersist {
  market(market: TwoPartyBinaryBet): Promise<void>;
  pair(pair: MatchedBetPair): Promise<void>;
  preimage(marketId: string, preimage: string): Promise<void>;
  signature(marketId: string, signature: string): Promise<void>;
  proofSignatures(marketId: string, sigs: Map<string, string>): Promise<void>;
  pendingExchangeToken(pairId: string, side: "yes" | "no", token: string): Promise<void>;
  deletePendingExchangeToken(pairId: string, side: "yes" | "no"): Promise<void>;
}

export interface KannagiStore {
  /** Order book backed by the same DB. Use this to construct MarketState. */
  readonly orderBook: OrderBook;
  /** Persistence facade — call after each in-memory mutation. */
  readonly persist: KannagiPersist;
  /** Load all state from disk. Call once at server startup. */
  hydrate(): Promise<HydratedState>;
  /** Close the underlying SQLite handle. Idempotent. */
  close(): Promise<void>;
}

export interface OpenKannagiStoreOpts {
  /** Path to the SQLite DB file. Use `:memory:` for tests. */
  path: string;
}

export function openKannagiStore(opts: OpenKannagiStoreOpts): KannagiStore {
  const db = new Database(opts.path);
  db.exec(SCHEMA_SQL);
  log.info("kannagi store opened", { path: opts.path });

  const orderBook = createSqliteOrderBook(db);
  const persist = createPersist(db);

  return {
    orderBook,
    persist,
    hydrate: () => Promise.resolve(hydrateAll(db)),
    close: () => {
      db.close();
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

function hydrateAll(db: Database): HydratedState {
  const markets = new Map<string, TwoPartyBinaryBet>();
  for (const row of db.prepare("SELECT json FROM markets").all<{ json: string }>()) {
    const m = JSON.parse(row.json) as TwoPartyBinaryBet;
    markets.set(m.id, m);
  }

  const matchedPairs = new Map<string, MatchedBetPair>();
  for (const row of db.prepare("SELECT json FROM matched_pairs").all<{ json: string }>()) {
    const p = JSON.parse(row.json) as MatchedBetPair;
    matchedPairs.set(p.pair_id, p);
  }

  const resolvedPreimages = new Map<string, string>();
  for (
    const row of db.prepare("SELECT market_id, preimage FROM resolved_preimages")
      .all<{ market_id: string; preimage: string }>()
  ) {
    resolvedPreimages.set(row.market_id, row.preimage);
  }

  const resolvedSignatures = new Map<string, string>();
  for (
    const row of db.prepare("SELECT market_id, signature FROM resolved_signatures")
      .all<{ market_id: string; signature: string }>()
  ) {
    resolvedSignatures.set(row.market_id, row.signature);
  }

  const resolvedProofSignatures = new Map<string, Map<string, string>>();
  for (
    const row of db.prepare("SELECT market_id, proof_secret, signature FROM resolved_proof_signatures")
      .all<{ market_id: string; proof_secret: string; signature: string }>()
  ) {
    let inner = resolvedProofSignatures.get(row.market_id);
    if (!inner) {
      inner = new Map();
      resolvedProofSignatures.set(row.market_id, inner);
    }
    inner.set(row.proof_secret, row.signature);
  }

  const pendingExchangeTokens = new Map<string, string>();
  for (
    const row of db.prepare("SELECT pair_id, side, token FROM pending_exchange_tokens")
      .all<{ pair_id: string; side: "yes" | "no"; token: string }>()
  ) {
    pendingExchangeTokens.set(`${row.pair_id}_${row.side}`, row.token);
  }

  log.info("hydrated", {
    markets: markets.size,
    matched_pairs: matchedPairs.size,
    resolved_preimages: resolvedPreimages.size,
    resolved_signatures: resolvedSignatures.size,
    resolved_proof_signatures: resolvedProofSignatures.size,
    pending_exchange_tokens: pendingExchangeTokens.size,
  });

  return {
    markets,
    matchedPairs,
    resolvedPreimages,
    resolvedSignatures,
    resolvedProofSignatures,
    pendingExchangeTokens,
  };
}

// ---------------------------------------------------------------------------
// Persist (write-through, called after each in-memory mutation)
// ---------------------------------------------------------------------------

function createPersist(db: Database): KannagiPersist {
  const upsertMarket = db.prepare(
    "INSERT INTO markets (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
  );
  const upsertPair = db.prepare(
    "INSERT INTO matched_pairs (pair_id, market_id, json) VALUES (?, ?, ?) " +
      "ON CONFLICT(pair_id) DO UPDATE SET market_id = excluded.market_id, json = excluded.json",
  );
  const upsertPreimage = db.prepare(
    "INSERT INTO resolved_preimages (market_id, preimage) VALUES (?, ?) " +
      "ON CONFLICT(market_id) DO UPDATE SET preimage = excluded.preimage",
  );
  const upsertSignature = db.prepare(
    "INSERT INTO resolved_signatures (market_id, signature) VALUES (?, ?) " +
      "ON CONFLICT(market_id) DO UPDATE SET signature = excluded.signature",
  );
  const upsertProofSig = db.prepare(
    "INSERT INTO resolved_proof_signatures (market_id, proof_secret, signature) VALUES (?, ?, ?) " +
      "ON CONFLICT(market_id, proof_secret) DO UPDATE SET signature = excluded.signature",
  );
  const upsertPendingToken = db.prepare(
    "INSERT INTO pending_exchange_tokens (pair_id, side, token) VALUES (?, ?, ?) " +
      "ON CONFLICT(pair_id, side) DO UPDATE SET token = excluded.token",
  );
  const deletePendingToken = db.prepare(
    "DELETE FROM pending_exchange_tokens WHERE pair_id = ? AND side = ?",
  );

  return {
    market(market) {
      upsertMarket.run(market.id, JSON.stringify(market));
      return Promise.resolve();
    },
    pair(pair) {
      upsertPair.run(pair.pair_id, pair.market_id, JSON.stringify(pair));
      return Promise.resolve();
    },
    preimage(marketId, preimage) {
      upsertPreimage.run(marketId, preimage);
      return Promise.resolve();
    },
    signature(marketId, signature) {
      upsertSignature.run(marketId, signature);
      return Promise.resolve();
    },
    proofSignatures(marketId, sigs) {
      // Snapshot of the inner map. Each (marketId, secret) row is upserted —
      // existing rows are not deleted, so callers that merge new signatures
      // into an existing map (server-routes /proof-signatures) keep working
      // with no extra coordination.
      db.transaction(() => {
        for (const [secret, sig] of sigs) {
          upsertProofSig.run(marketId, secret, sig);
        }
      })();
      return Promise.resolve();
    },
    pendingExchangeToken(pairId, side, token) {
      upsertPendingToken.run(pairId, side, token);
      return Promise.resolve();
    },
    deletePendingExchangeToken(pairId, side) {
      deletePendingToken.run(pairId, side);
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite OrderBook
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  market_id: string;
  bettor_pubkey: string;
  side: "yes" | "no";
  amount_sats: number;
  remaining_sats: number;
  ts: number;
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

function createSqliteOrderBook(db: Database): OrderBook {
  const insertOrder = db.prepare(
    "INSERT INTO orders (id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const deleteOrder = db.prepare("DELETE FROM orders WHERE id = ?");
  const selectOpenAll = db.prepare(
    "SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts " +
      "FROM orders WHERE market_id = ? AND remaining_sats > 0 ORDER BY ts ASC",
  );
  const selectOpenSide = db.prepare(
    "SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts " +
      "FROM orders WHERE market_id = ? AND side = ? AND remaining_sats > 0 ORDER BY ts ASC",
  );
  const updateRemaining = db.prepare(
    "UPDATE orders SET remaining_sats = ? WHERE id = ?",
  );

  return {
    addOrder(order) {
      const remaining = order.remaining_sats ?? order.amount_sats;
      insertOrder.run(
        order.id,
        order.market_id,
        order.bettor_pubkey,
        order.side,
        order.amount_sats,
        remaining,
        order.timestamp,
      );
      return Promise.resolve({ ...order, remaining_sats: remaining });
    },

    cancelOrder(id) {
      const changes = deleteOrder.run(id);
      return Promise.resolve(changes > 0);
    },

    getOpenOrders(market_id, side) {
      const rows = side
        ? selectOpenSide.all<OrderRow>(market_id, side)
        : selectOpenAll.all<OrderRow>(market_id);
      return Promise.resolve(rows.map(rowToOrder));
    },

    matchOrders(market_id) {
      // SQLite uses database-level write locks; wrapping match+update in a
      // transaction serialises concurrent matchers in this process. The Fly
      // app runs single-process, so contention is not real today, but the
      // transaction also makes the partial-update step atomic.
      const proposals = db.transaction((): MatchProposal[] => {
        const yesOrders = selectOpenSide.all<OrderRow>(market_id, "yes").map(rowToOrder);
        const noOrders = selectOpenSide.all<OrderRow>(market_id, "no").map(rowToOrder);

        const result: MatchProposal[] = [];
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
            result.push({
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

        for (const order of [...yesOrders, ...noOrders]) {
          if (!changed.has(order.id)) continue;
          updateRemaining.run(order.remaining_sats, order.id);
        }

        return result;
      })();

      return Promise.resolve(proposals);
    },
  };
}
