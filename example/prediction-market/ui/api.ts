import type { Market, MarketCategory } from "./mock-data";

const API_BASE = "/markets";

/** Fetch wrapper -- standalone market UI uses same-origin relative paths. */
function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Match info returned by the pure matchmaker bet endpoint. */
export interface MatchInfo {
  pair_id: string;
  counterparty_pubkey: string;
  group_pubkey_yes: string;
  group_pubkey_no: string;
  locktime_exchange: number;
  locktime_market: number;
  amount_sats: number;
}

export interface BetResult {
  order_id: string;
  side: string;
  amount_sats: number;
  matches: MatchInfo[];
  market: { yes_pool_sats: number; no_pool_sats: number };
  error?: string;
}

export type ConditionType = "jsonpath_gt" | "jsonpath_lt" | "jsonpath_equals" | "contains_text" | "price_above" | "price_below";

export interface ResolutionCondition {
  type: ConditionType;
  jsonpath?: string;
  threshold?: number;
  expected_text?: string;
  description: string;
}

export interface CreateMarketParams {
  title: string;
  description: string;
  category: MarketCategory;
  resolution_url: string;
  resolution_condition: ResolutionCondition;
  resolution_deadline: number;
  min_bet_sats: number;
  max_bet_sats?: number;
  fee_ppm?: number;
}

// ---------------------------------------------------------------------------
// Market CRUD
// ---------------------------------------------------------------------------

export async function fetchMarkets(category?: string): Promise<Market[]> {
  const params = new URLSearchParams();
  if (category && category !== "all") {
    params.set("category", category);
  }
  const qs = params.toString();
  const url = `${API_BASE}${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch markets: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchMarket(id: string): Promise<Market> {
  const res = await apiFetch(`${API_BASE}/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch market: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function createMarket(
  params: CreateMarketParams,
): Promise<Market> {
  const res = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `Failed to create market: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) message = parsed.message;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Betting (pure matchmaker — server announces matches, never touches tokens)
// ---------------------------------------------------------------------------

export async function placeBet(
  marketId: string,
  side: "yes" | "no",
  amount_sats: number,
  bettor_pubkey: string,
): Promise<BetResult> {
  const res = await apiFetch(`${API_BASE}/${marketId}/bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side, amount_sats, bettor_pubkey }),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `Bet failed: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) message = parsed.message;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Token exchange (non-custodial relay)
// ---------------------------------------------------------------------------

export interface SubmitTokenResult {
  pair_id: string;
  status: "pending" | "locked";
  redeemable_token?: string;
  message?: string;
}

/**
 * Submit a P2PK-locked token for a matched pair.
 *
 * The server VERIFIES token conditions but cannot spend them.
 * When both sides submit, the server distributes tokens.
 */
export async function submitToken(
  marketId: string,
  pair_id: string,
  cashu_token: string,
  bettor_pubkey: string,
): Promise<SubmitTokenResult> {
  const res = await apiFetch(`${API_BASE}/${marketId}/submit-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pair_id, cashu_token, bettor_pubkey }),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `Token submission failed: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) message = parsed.error;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Faucet (non-custodial — returns cashuB token string)
// ---------------------------------------------------------------------------

export interface FaucetResult {
  cashu_token: string;
  amount_sats: number;
}

/**
 * Request faucet tokens. Returns a cashuB token string that the client
 * swaps at the mint to take ownership.
 */
export async function requestFaucet(amount_sats = 1000): Promise<FaucetResult> {
  const res = await apiFetch(`${API_BASE}/wallet/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount_sats }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Faucet failed" }));
    throw new Error(body.error || "Faucet failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

export interface RedeemResult {
  outcome: string;
  winning_pairs: number;
  total_winning_sats: number;
  oracle_signatures?: Record<string, string>;
  oracle_pubkey?: string;
  oracle_signature?: string;
  preimage?: string;
  redeem_instructions?: string;
}

export async function redeemWinnings(marketId: string, pubkey: string): Promise<RedeemResult> {
  const res = await apiFetch(`${API_BASE}/${marketId}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey }),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `Redeem failed: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) message = parsed.error;
      if (parsed.message) message = parsed.message;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Sign proofs (client submits proof secrets for Oracle signing)
// ---------------------------------------------------------------------------

export interface SignProofsResult {
  outcome: string;
  oracle_pubkey?: string;
  oracle_signatures: Record<string, string>;
  signed_count: number;
  total_requested: number;
  redeem_instructions?: string;
}

/**
 * Submit proof secrets for Oracle signing after resolution.
 *
 * The winner calls this with their held token's proof.secret values.
 * The Oracle signs SHA256(proof.secret) for each proof.
 */
export async function signProofs(
  marketId: string,
  pubkey: string,
  proof_secrets: string[],
): Promise<SignProofsResult> {
  const res = await apiFetch(`${API_BASE}/${marketId}/sign-proofs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, proof_secrets }),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = `Sign proofs failed: ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) message = parsed.error;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }
  return res.json();
}
