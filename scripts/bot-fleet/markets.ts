/**
 * Polymarket-aligned seed markets.
 *
 * Each entry mirrors a topic that Polymarket has had open in roughly its
 * current era: politics, crypto, economics, sports, science / AI, culture.
 * The titles are paraphrased — the goal is a representative sample of the
 * kinds of binary-outcome questions the platform must support, not a 1:1
 * copy of any particular live market.
 *
 * The resolution_url fields point at real public data sources where
 * possible (CoinGecko, ESPN, ourworldindata) so a TLSNotary-backed
 * resolution path could in principle be exercised. For markets where the
 * truth is not directly machine-readable (e.g., "Will Trump be indicted"),
 * we point at a public news source as a placeholder; the bot fleet doesn't
 * exercise resolution itself, only bet liquidity.
 */

export type MarketCategory =
  | "crypto"
  | "politics"
  | "economics"
  | "sports"
  | "science"
  | "culture";

export interface SeedMarket {
  /** Short slug; used for logging only — server assigns the real id. */
  slug: string;
  title: string;
  description: string;
  category: MarketCategory;
  resolution_url: string;
  resolution_condition: {
    type:
      | "jsonpath_gt"
      | "jsonpath_lt"
      | "jsonpath_equals"
      | "contains_text"
      | "price_above"
      | "price_below";
    jsonpath?: string;
    threshold?: number;
    expected_text?: string;
  };
  /** Days until resolution_deadline. */
  resolution_in_days: number;
  /** Realistic bias: probability that YES is correct, in [0, 1]. Drives bot behavior. */
  yes_bias: number;
  /** Typical bet size on this market in sats (Polymarket-style scaling). */
  typical_bet_sats: number;
}

export const POLYMARKET_SEED_MARKETS: SeedMarket[] = [
  // --- Crypto ---
  {
    slug: "btc-200k-2026",
    title: "Will Bitcoin reach $200,000 in 2026?",
    description:
      "Resolves YES if BTC/USD on CoinGecko prints $200,000 or above at any point in 2026. " +
      "Verified via TLSNotary proof from api.coingecko.com.",
    category: "crypto",
    resolution_url:
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    resolution_condition: {
      type: "jsonpath_gt",
      jsonpath: "bitcoin.usd",
      threshold: 200000,
    },
    resolution_in_days: 240,
    yes_bias: 0.32,
    typical_bet_sats: 5000,
  },
  {
    slug: "eth-5k-eoy-2026",
    title: "Will ETH/USD trade above $5,000 on December 31, 2026?",
    description:
      "Snapshot price on the resolution deadline. Source: CoinGecko.",
    category: "crypto",
    resolution_url:
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    resolution_condition: {
      type: "jsonpath_gt",
      jsonpath: "ethereum.usd",
      threshold: 5000,
    },
    resolution_in_days: 250,
    yes_bias: 0.41,
    typical_bet_sats: 3000,
  },
  {
    slug: "btc-etf-net-flow-positive-q3",
    title: "Will US spot BTC ETFs end Q3 2026 with net positive YTD inflow?",
    description: "Resolves on the basis of aggregated reported flows.",
    category: "crypto",
    resolution_url: "https://api.coingecko.com/api/v3/coins/bitcoin",
    resolution_condition: {
      type: "jsonpath_gt",
      jsonpath: "market_data.market_cap.usd",
      threshold: 1,
    },
    resolution_in_days: 150,
    yes_bias: 0.78,
    typical_bet_sats: 2000,
  },

  // --- Politics ---
  {
    slug: "us-recession-declared-2026",
    title: "Will the NBER declare a US recession in 2026?",
    description: "NBER official Business Cycle Dating Committee announcement.",
    category: "politics",
    resolution_url: "https://www.nber.org/research/business-cycle-dating",
    resolution_condition: { type: "contains_text", expected_text: "Peak" },
    resolution_in_days: 300,
    yes_bias: 0.27,
    typical_bet_sats: 4000,
  },
  {
    slug: "tokyo-gov-turnout-60",
    title: "Will Tokyo gubernatorial election turnout exceed 60%?",
    description:
      "Official Tokyo Metropolitan Government election commission report.",
    category: "politics",
    resolution_url: "https://www.senkyo.metro.tokyo.lg.jp/",
    resolution_condition: { type: "contains_text", expected_text: "60.0" },
    resolution_in_days: 95,
    yes_bias: 0.42,
    typical_bet_sats: 1500,
  },
  {
    slug: "g7-summit-2026",
    title: "Will the 2026 G7 summit produce a joint communique on AI safety?",
    description: "Joint communique from the official G7 host site.",
    category: "politics",
    resolution_url: "https://www.g7.utoronto.ca/",
    resolution_condition: {
      type: "contains_text",
      expected_text: "artificial intelligence",
    },
    resolution_in_days: 60,
    yes_bias: 0.65,
    typical_bet_sats: 1200,
  },

  // --- Economics ---
  {
    slug: "fed-may-cut-25bps",
    title: "Will the Fed cut rates by exactly 25bps at the May 2026 FOMC?",
    description: "FOMC statement published on federalreserve.gov.",
    category: "economics",
    resolution_url:
      "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    resolution_condition: {
      type: "contains_text",
      expected_text: "1/4 percentage point",
    },
    resolution_in_days: 14,
    yes_bias: 0.58,
    typical_bet_sats: 8000,
  },
  {
    slug: "boj-rate-50bps-by-eoy",
    title:
      "Will the BoJ raise the policy rate to 0.5% or higher by end of 2026?",
    description: "Bank of Japan statement on policy rate.",
    category: "economics",
    resolution_url: "https://www.boj.or.jp/en/announcements/release_2026/",
    resolution_condition: { type: "contains_text", expected_text: "0.5" },
    resolution_in_days: 250,
    yes_bias: 0.36,
    typical_bet_sats: 2500,
  },

  // --- Sports ---
  {
    slug: "japan-asian-cup-2027-final",
    title: "Will Japan reach the AFC Asian Cup 2027 final?",
    description: "Bracket position per the official AFC site.",
    category: "sports",
    resolution_url: "https://www.the-afc.com/en/national/afc_asian_cup.html",
    resolution_condition: { type: "contains_text", expected_text: "Japan" },
    resolution_in_days: 280,
    yes_bias: 0.31,
    typical_bet_sats: 1000,
  },
  {
    slug: "wbc-2026-japan-finals",
    title: "Will Japan reach the World Baseball Classic 2026 final?",
    description: "WBC bracket per the official site.",
    category: "sports",
    resolution_url: "https://www.worldbaseballclassic.com/",
    resolution_condition: { type: "contains_text", expected_text: "Japan" },
    resolution_in_days: 30,
    yes_bias: 0.55,
    typical_bet_sats: 1800,
  },

  // --- Science / AI ---
  {
    slug: "gpt5-release-2026",
    title: "Will OpenAI release GPT-5 publicly in 2026?",
    description: "Public release announcement on openai.com.",
    category: "science",
    resolution_url: "https://openai.com/blog",
    resolution_condition: { type: "contains_text", expected_text: "GPT-5" },
    resolution_in_days: 240,
    yes_bias: 0.62,
    typical_bet_sats: 6000,
  },
  {
    slug: "starship-orbit-2026",
    title: "Will SpaceX Starship complete a full orbital mission in 2026?",
    description: "SpaceX launch results page.",
    category: "science",
    resolution_url: "https://www.spacex.com/launches/",
    resolution_condition: { type: "contains_text", expected_text: "orbital" },
    resolution_in_days: 240,
    yes_bias: 0.68,
    typical_bet_sats: 2200,
  },

  // --- Culture ---
  {
    slug: "studio-ghibli-feature-2026",
    title: "Will Studio Ghibli announce a new feature film in 2026?",
    description: "Official ghibli.jp announcement.",
    category: "culture",
    resolution_url: "https://www.ghibli.jp/",
    resolution_condition: { type: "contains_text", expected_text: "新作" },
    resolution_in_days: 180,
    yes_bias: 0.48,
    typical_bet_sats: 800,
  },
];
