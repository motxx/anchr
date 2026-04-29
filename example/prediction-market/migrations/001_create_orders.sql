-- Prediction market order book persistence
--
-- Apply with:
--   psql "$DATABASE_URL" -f example/prediction-market/migrations/001_create_orders.sql
--
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS prediction_market_orders (
  id              TEXT PRIMARY KEY,
  market_id       TEXT NOT NULL,
  bettor_pubkey   TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  amount_sats     BIGINT NOT NULL CHECK (amount_sats > 0),
  remaining_sats  BIGINT NOT NULL CHECK (remaining_sats >= 0),
  ts              BIGINT NOT NULL,  -- unix seconds; FIFO ordering key
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: only open orders are scanned during matching, so the index
-- size stays bounded by the active book rather than the full history.
CREATE INDEX IF NOT EXISTS idx_pm_orders_open_fifo
  ON prediction_market_orders (market_id, side, ts)
  WHERE remaining_sats > 0;
