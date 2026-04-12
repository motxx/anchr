import type { Market, MarketCategory } from "./mock-data";
import { apiFetch } from "../api-config";

const API_BASE = "/markets";

export interface BetResult {
  order_id: string;
  side: string;
  amount_sats: number;
  cashu_locked: boolean;
  matches: Array<{ pair_id: string; amount_sats: number; status: string; has_htlc: boolean }>;
  market: { yes_pool_sats: number; no_pool_sats: number };
  // Error fields
  error?: string;
}

export interface CreateMarketParams {
  title: string;
  description: string;
  category: MarketCategory;
  resolution_url: string;
  resolution_deadline: number;
  min_bet_sats: number;
  max_bet_sats?: number;
  fee_ppm?: number;
}

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
