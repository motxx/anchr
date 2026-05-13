/**
 * SQLite-backed persistence for the two-party binary bet server.
 *
 * Owns one DB file containing the matching queue (durable bets + FIFO matching)
 * plus the runtime maps so a Fly machine restart recovers full state:
 *
 *   - markets                 (TwoPartyBinaryBet, JSON blob keyed by market_id)
 *   - matched_pairs           (MatchedBetPair,    JSON blob keyed by pair_id)
 *   - resolved_preimages      (one preimage per market)
 *   - resolved_signatures     (one Schnorr signature per market)
 *   - resolved_proof_signatures (per-Cashu-proof signatures, denormalised)
 *   - pending_exchange_tokens (transient cashuB tokens during pair exchange)
 *   - faucet_tokens           (optional public-testnet cashuB token bank)
 *
 * Concurrency: a single Fly machine, single Deno process. SQLite WAL gives
 * us concurrent readers + one writer, which matches our load profile (the
 * matcher and auto-resolver run in-process, no horizontal scaling).
 */

import { Database } from "@db/sqlite";
import { getLogger } from "@anchr/core-runtime/logger";
import type { MatchingQueue } from "./matching-queue.ts";
import type {
  MatchedBetPair,
  MatchProposal,
  PendingBet,
  TwoPartyBinaryBet,
} from "./market-types.ts";

const log = getLogger(["anchr", "two-party-binary-bet", "market-store"]);

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pending_bets (
  id              TEXT PRIMARY KEY,
  market_id       TEXT NOT NULL,
  bettor_pubkey   TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  amount_sats     INTEGER NOT NULL CHECK (amount_sats > 0),
  remaining_sats  INTEGER NOT NULL CHECK (remaining_sats >= 0),
  ts              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_bets_fifo
  ON pending_bets (market_id, side, ts)
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

CREATE TABLE IF NOT EXISTS faucet_tokens (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL,
  amount_sats INTEGER NOT NULL CHECK (amount_sats >= 0),
  claimed_at  INTEGER,
  claimed_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_faucet_tokens_unclaimed
  ON faucet_tokens (claimed_at, amount_sats);
`;

export interface HydratedState {
  markets: Map<string, TwoPartyBinaryBet>;
  matchedPairs: Map<string, MatchedBetPair>;
  resolvedPreimages: Map<string, string>;
  resolvedSignatures: Map<string, string>;
  resolvedProofSignatures: Map<string, Map<string, string>>;
  pendingExchangeTokens: Map<string, string>;
  faucetTokens: Map<string, FaucetTokenRecord>;
}

export interface FaucetTokenRecord {
  id: string;
  token: string;
  amount_sats: number;
  claimed_at?: number;
  claimed_by?: string;
}

export interface MarketPersist {
  market(market: TwoPartyBinaryBet): Promise<void>;
  pair(pair: MatchedBetPair): Promise<void>;
  preimage(marketId: string, preimage: string): Promise<void>;
  signature(marketId: string, signature: string): Promise<void>;
  proofSignatures(marketId: string, sigs: Map<string, string>): Promise<void>;
  pendingExchangeToken(
    pairId: string,
    side: "yes" | "no",
    token: string,
  ): Promise<void>;
  deletePendingExchangeToken(pairId: string, side: "yes" | "no"): Promise<void>;
  faucetToken(token: FaucetTokenRecord): Promise<void>;
  claimFaucetToken(
    id: string,
    claimedAt: number,
    claimedBy: string,
  ): Promise<boolean>;
}

export interface MarketStore {
  /** Matching queue backed by the same DB. Use this to construct MarketState. */
  readonly matchingQueue: MatchingQueue;
  /** Persistence facade — call after each in-memory mutation. */
  readonly persist: MarketPersist;
  /** Load all state from disk. Call once at server startup. */
  hydrate(): Promise<HydratedState>;
  /** Close the underlying SQLite handle. Idempotent. */
  close(): Promise<void>;
}

export interface OpenMarketStoreOpts {
  /** Path to the SQLite DB file. Use `:memory:` for tests. */
  path: string;
}

export function openMarketStore(opts: OpenMarketStoreOpts): MarketStore {
  const db = new Database(opts.path);
  db.exec(SCHEMA_SQL);
  log.info("market store opened", { path: opts.path });

  const matchingQueue = createSqliteMatchingQueue(db);
  const persist = createPersist(db);

  return {
    matchingQueue,
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
  for (
    const row of db.prepare("SELECT json FROM markets").all<{ json: string }>()
  ) {
    const m = JSON.parse(row.json) as TwoPartyBinaryBet;
    markets.set(m.id, m);
  }

  const matchedPairs = new Map<string, MatchedBetPair>();
  for (
    const row of db.prepare("SELECT json FROM matched_pairs").all<
      { json: string }
    >()
  ) {
    const p = JSON.parse(row.json) as MatchedBetPair;
    matchedPairs.set(p.pair_id, p);
  }

  const resolvedPreimages = new Map<string, string>();
  for (
    const row of db.prepare(
      "SELECT market_id, preimage FROM resolved_preimages",
    )
      .all<{ market_id: string; preimage: string }>()
  ) {
    resolvedPreimages.set(row.market_id, row.preimage);
  }

  const resolvedSignatures = new Map<string, string>();
  for (
    const row of db.prepare(
      "SELECT market_id, signature FROM resolved_signatures",
    )
      .all<{ market_id: string; signature: string }>()
  ) {
    resolvedSignatures.set(row.market_id, row.signature);
  }

  const resolvedProofSignatures = new Map<string, Map<string, string>>();
  for (
    const row of db.prepare(
      "SELECT market_id, proof_secret, signature FROM resolved_proof_signatures",
    )
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
    const row of db.prepare(
      "SELECT pair_id, side, token FROM pending_exchange_tokens",
    )
      .all<{ pair_id: string; side: "yes" | "no"; token: string }>()
  ) {
    pendingExchangeTokens.set(`${row.pair_id}_${row.side}`, row.token);
  }

  const faucetTokens = new Map<string, FaucetTokenRecord>();
  for (
    const row of db.prepare(
      "SELECT id, token, amount_sats, claimed_at, claimed_by FROM faucet_tokens",
    )
      .all<{
        id: string;
        token: string;
        amount_sats: number;
        claimed_at: number | null;
        claimed_by: string | null;
      }>()
  ) {
    faucetTokens.set(row.id, {
      id: row.id,
      token: row.token,
      amount_sats: row.amount_sats,
      ...(row.claimed_at === null ? {} : { claimed_at: row.claimed_at }),
      ...(row.claimed_by === null ? {} : { claimed_by: row.claimed_by }),
    });
  }

  log.info("hydrated", {
    markets: markets.size,
    matched_pairs: matchedPairs.size,
    resolved_preimages: resolvedPreimages.size,
    resolved_signatures: resolvedSignatures.size,
    resolved_proof_signatures: resolvedProofSignatures.size,
    pending_exchange_tokens: pendingExchangeTokens.size,
    faucet_tokens: faucetTokens.size,
  });

  return {
    markets,
    matchedPairs,
    resolvedPreimages,
    resolvedSignatures,
    resolvedProofSignatures,
    pendingExchangeTokens,
    faucetTokens,
  };
}

// ---------------------------------------------------------------------------
// Persist (write-through, called after each in-memory mutation)
// ---------------------------------------------------------------------------

function createPersist(db: Database): MarketPersist {
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
  const upsertFaucetToken = db.prepare(
    "INSERT INTO faucet_tokens (id, token, amount_sats, claimed_at, claimed_by) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET token = excluded.token, amount_sats = excluded.amount_sats",
  );
  const claimFaucetToken = db.prepare(
    "UPDATE faucet_tokens SET claimed_at = ?, claimed_by = ? WHERE id = ? AND claimed_at IS NULL",
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
    faucetToken(token) {
      upsertFaucetToken.run(
        token.id,
        token.token,
        token.amount_sats,
        token.claimed_at ?? null,
        token.claimed_by ?? null,
      );
      return Promise.resolve();
    },
    claimFaucetToken(id, claimedAt, claimedBy) {
      const changes = claimFaucetToken.run(claimedAt, claimedBy, id);
      return Promise.resolve(changes > 0);
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite MatchingQueue
// ---------------------------------------------------------------------------

interface PendingBetRow {
  id: string;
  market_id: string;
  bettor_pubkey: string;
  side: "yes" | "no";
  amount_sats: number;
  remaining_sats: number;
  ts: number;
}

function rowToBet(row: PendingBetRow): PendingBet {
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

function createSqliteMatchingQueue(db: Database): MatchingQueue {
  const insertBet = db.prepare(
    "INSERT INTO pending_bets (id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const deleteBet = db.prepare("DELETE FROM pending_bets WHERE id = ?");
  const selectPendingAll = db.prepare(
    "SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts " +
      "FROM pending_bets WHERE market_id = ? AND remaining_sats > 0 ORDER BY ts ASC",
  );
  const selectPendingSide = db.prepare(
    "SELECT id, market_id, bettor_pubkey, side, amount_sats, remaining_sats, ts " +
      "FROM pending_bets WHERE market_id = ? AND side = ? AND remaining_sats > 0 ORDER BY ts ASC",
  );
  const updateRemaining = db.prepare(
    "UPDATE pending_bets SET remaining_sats = ? WHERE id = ?",
  );

  return {
    enqueue(bet) {
      const remaining = bet.remaining_sats ?? bet.amount_sats;
      insertBet.run(
        bet.id,
        bet.market_id,
        bet.bettor_pubkey,
        bet.side,
        bet.amount_sats,
        remaining,
        bet.timestamp,
      );
      return Promise.resolve({ ...bet, remaining_sats: remaining });
    },

    cancel(id) {
      const changes = deleteBet.run(id);
      return Promise.resolve(changes > 0);
    },

    listPending(market_id, side) {
      const rows = side
        ? selectPendingSide.all<PendingBetRow>(market_id, side)
        : selectPendingAll.all<PendingBetRow>(market_id);
      return Promise.resolve(rows.map(rowToBet));
    },

    findMatches(market_id) {
      // SQLite uses database-level write locks; wrapping match+update in a
      // transaction serialises concurrent matchers in this process. The Fly
      // app runs single-process, so contention is not real today, but the
      // transaction also makes the partial-update step atomic.
      const proposals = db.transaction((): MatchProposal[] => {
        const yesBets = selectPendingSide.all<PendingBetRow>(market_id, "yes")
          .map(rowToBet);
        const noBets = selectPendingSide.all<PendingBetRow>(market_id, "no")
          .map(rowToBet);

        const result: MatchProposal[] = [];
        const changed = new Set<string>();
        let ni = 0;

        for (const yes of yesBets) {
          while (ni < noBets.length && yes.remaining_sats > 0) {
            const no = noBets[ni]!;
            if (no.remaining_sats <= 0) {
              ni++;
              continue;
            }

            const matchAmount = Math.min(yes.remaining_sats, no.remaining_sats);
            result.push({
              yes_bet_id: yes.id,
              no_bet_id: no.id,
              amount_sats: matchAmount,
            });

            yes.remaining_sats -= matchAmount;
            no.remaining_sats -= matchAmount;
            changed.add(yes.id);
            changed.add(no.id);

            if (no.remaining_sats <= 0) ni++;
          }
        }

        for (const bet of [...yesBets, ...noBets]) {
          if (!changed.has(bet.id)) continue;
          updateRemaining.run(bet.remaining_sats, bet.id);
        }

        return result;
      })();

      return Promise.resolve(proposals);
    },
  };
}
