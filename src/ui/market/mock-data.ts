export type MarketCategory = "crypto" | "sports" | "politics" | "economics" | "custom";
export type MarketStatus = "open" | "closed" | "resolving" | "resolved_yes" | "resolved_no" | "expired";

export interface Market {
  id: string;
  title: string;
  description: string;
  category: MarketCategory;
  resolution_url: string;
  resolution_deadline: number;
  yes_pool_sats: number;
  no_pool_sats: number;
  min_bet_sats: number;
  max_bet_sats: number;
  fee_ppm: number;
  oracle_pubkey: string;
  htlc_hash: string;
  creator_pubkey: string;
  status: MarketStatus;
  volume_sats: number;
  num_bettors: number;
  created_at: number;
}

const now = Math.floor(Date.now() / 1000);
const DAY = 86400;

export const MOCK_MARKETS: Market[] = [
  {
    id: "a1b2c3d4e5f6",
    title: "Will BTC/JPY exceed ¥15,000,000 by end of April 2026?",
    description: "Resolves YES if the best bid price on bitFlyer BTC/JPY market is above 15,000,000 JPY at the resolution deadline. Verified via TLSNotary proof from api.bitflyer.com.",
    category: "crypto",
    resolution_url: "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY",
    resolution_deadline: now + 24 * DAY,
    yes_pool_sats: 450_000,
    no_pool_sats: 310_000,
    min_bet_sats: 100,
    max_bet_sats: 1_000_000,
    fee_ppm: 10_000,
    oracle_pubkey: "npub1oracle...abc",
    htlc_hash: "f8e86960ff0ad691...",
    creator_pubkey: "npub1creator...xyz",
    status: "open",
    volume_sats: 2_340_000,
    num_bettors: 47,
    created_at: now - 5 * DAY,
  },
  {
    id: "b2c3d4e5f6a1",
    title: "Will Nostr reach 10M monthly active users by July 2026?",
    description: "Resolves YES if nostr.band analytics API reports ≥10,000,000 unique pubkeys with at least one event in the 30 days prior to the resolution deadline.",
    category: "custom",
    resolution_url: "https://api.nostr.band/v0/stats",
    resolution_deadline: now + 90 * DAY,
    yes_pool_sats: 120_000,
    no_pool_sats: 890_000,
    min_bet_sats: 10,
    max_bet_sats: 500_000,
    fee_ppm: 5_000,
    oracle_pubkey: "npub1oracle...def",
    htlc_hash: "a3c4d5e6f7890...",
    creator_pubkey: "npub1alice...123",
    status: "open",
    volume_sats: 1_560_000,
    num_bettors: 128,
    created_at: now - 12 * DAY,
  },
  {
    id: "c3d4e5f6a1b2",
    title: "Will the Fed cut rates at the June 2026 FOMC meeting?",
    description: "Resolves YES if the Federal Reserve announces a reduction in the federal funds target rate at or after the June 2026 FOMC meeting. Verified via TLSNotary proof from the Fed's official press release.",
    category: "economics",
    resolution_url: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    resolution_deadline: now + 60 * DAY,
    yes_pool_sats: 670_000,
    no_pool_sats: 530_000,
    min_bet_sats: 50,
    max_bet_sats: 2_000_000,
    fee_ppm: 8_000,
    oracle_pubkey: "npub1oracle...ghi",
    htlc_hash: "b4c5d6e7f8901...",
    creator_pubkey: "npub1bob...456",
    status: "open",
    volume_sats: 5_890_000,
    num_bettors: 203,
    created_at: now - 3 * DAY,
  },
  {
    id: "d4e5f6a1b2c3",
    title: "Will ETH/BTC ratio go below 0.01 in 2026?",
    description: "Resolves YES if the ETH/BTC trading pair drops below 0.01 at any point before the resolution deadline, as verified by TLSNotary proof from a major exchange API.",
    category: "crypto",
    resolution_url: "https://api.binance.com/api/v3/ticker/price?symbol=ETHBTC",
    resolution_deadline: now + 180 * DAY,
    yes_pool_sats: 230_000,
    no_pool_sats: 180_000,
    min_bet_sats: 100,
    max_bet_sats: 500_000,
    fee_ppm: 10_000,
    oracle_pubkey: "npub1oracle...jkl",
    htlc_hash: "c5d6e7f8g9012...",
    creator_pubkey: "npub1charlie...789",
    status: "open",
    volume_sats: 890_000,
    num_bettors: 34,
    created_at: now - 8 * DAY,
  },
  {
    id: "e5f6a1b2c3d4",
    title: "Will Japan legalize Bitcoin as legal tender by 2027?",
    description: "Resolves YES if Japan officially recognizes Bitcoin as legal tender (not just a legal payment method) before January 1, 2027.",
    category: "politics",
    resolution_url: "https://www.japantimes.co.jp/tag/bitcoin/",
    resolution_deadline: now + 270 * DAY,
    yes_pool_sats: 45_000,
    no_pool_sats: 1_200_000,
    min_bet_sats: 10,
    max_bet_sats: 1_000_000,
    fee_ppm: 5_000,
    oracle_pubkey: "npub1oracle...mno",
    htlc_hash: "d6e7f8g9h0123...",
    creator_pubkey: "npub1dave...abc",
    status: "open",
    volume_sats: 3_200_000,
    num_bettors: 89,
    created_at: now - 20 * DAY,
  },
  {
    id: "f6a1b2c3d4e5",
    title: "Did BTC/USD close above $100K on March 31, 2026?",
    description: "Resolved via TLSNotary proof from CoinGecko API. BTC closed at $103,450 — condition met.",
    category: "crypto",
    resolution_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    resolution_deadline: now - 6 * DAY,
    yes_pool_sats: 890_000,
    no_pool_sats: 340_000,
    min_bet_sats: 100,
    max_bet_sats: 1_000_000,
    fee_ppm: 10_000,
    oracle_pubkey: "npub1oracle...pqr",
    htlc_hash: "e7f8g9h0i1234...",
    creator_pubkey: "npub1eve...def",
    status: "resolved_yes",
    volume_sats: 4_500_000,
    num_bettors: 156,
    created_at: now - 45 * DAY,
  },
  {
    id: "g7b2c3d4e5f6",
    title: "Will Lightning Network capacity exceed 10,000 BTC by June 2026?",
    description: "Resolves YES if total Lightning Network capacity exceeds 10,000 BTC as reported by mempool.space API.",
    category: "crypto",
    resolution_url: "https://mempool.space/api/v1/lightning/statistics/latest",
    resolution_deadline: now + 75 * DAY,
    yes_pool_sats: 340_000,
    no_pool_sats: 290_000,
    min_bet_sats: 50,
    max_bet_sats: 500_000,
    fee_ppm: 7_500,
    oracle_pubkey: "npub1oracle...stu",
    htlc_hash: "f8g9h0i1j2345...",
    creator_pubkey: "npub1frank...ghi",
    status: "open",
    volume_sats: 1_120_000,
    num_bettors: 62,
    created_at: now - 15 * DAY,
  },
  {
    id: "h8c3d4e5f6a1",
    title: "Will the 2026 FIFA World Cup final have over 3.5 goals?",
    description: "Resolves YES if the total number of goals scored in the 2026 FIFA World Cup final match (including extra time) exceeds 3.",
    category: "sports",
    resolution_url: "https://api.football-data.org/v4/competitions/WC/matches",
    resolution_deadline: now + 100 * DAY,
    yes_pool_sats: 190_000,
    no_pool_sats: 210_000,
    min_bet_sats: 10,
    max_bet_sats: 100_000,
    fee_ppm: 10_000,
    oracle_pubkey: "npub1oracle...vwx",
    htlc_hash: "g9h0i1j2k3456...",
    creator_pubkey: "npub1grace...jkl",
    status: "open",
    volume_sats: 780_000,
    num_bettors: 45,
    created_at: now - 7 * DAY,
  },
];

export const CATEGORIES: { value: MarketCategory | "all"; label: string }[] = [
  { value: "all", label: "All Markets" },
  { value: "crypto", label: "Crypto" },
  { value: "economics", label: "Economics" },
  { value: "politics", label: "Politics" },
  { value: "sports", label: "Sports" },
  { value: "custom", label: "Custom" },
];
