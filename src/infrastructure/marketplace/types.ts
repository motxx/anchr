/**
 * Verified Data Marketplace types.
 *
 * Supports two payment modes:
 * - X-Cashu (direct): Buyer sends token, provider redeems immediately. Buyer risk.
 * - HTLC escrow: Oracle verifies TLSNotary proof before releasing preimage. Trustless.
 */

import type { TlsnRequirement } from "../../domain/types";
import type { MiddlewareHandler } from "hono";
import type { ListingStore } from "./listing-store";
import type { PreimageStore } from "../cashu/preimage-store";

// --- Data Listing ---

export interface DataListing {
  id: string;
  name: string;
  description?: string;
  /** Upstream API URL to fetch and prove via TLSNotary. */
  source_url: string;
  /** Price in sats for X-Cashu direct payment mode. */
  price_sats: number;
  /** Price in sats for HTLC escrow mode (typically higher due to Oracle fee). */
  htlc_price_sats: number;
  /** TLSNotary requirement for proof generation. */
  tlsn_requirement: TlsnRequirement;
  /** Max age in seconds before cached data is considered stale. */
  max_age_seconds: number;
  /** Whether this listing is active and purchasable. */
  active: boolean;
  created_at: number;
  /** Provider's Nostr pubkey (hex) — used as P2PK lock for HTLC redemption. */
  provider_pubkey?: string;
}

// --- Payment ---

export type PaymentMode = "cashu-direct" | "cashu-htlc";

export interface PaymentInfo {
  mode: PaymentMode;
  /** Verified token amount in sats. */
  amount_sats: number;
  /** Raw token string from the buyer. */
  token: string;
  /** SHA-256 hash of the token (for replay detection). */
  token_hash: string;
  /** HTLC hash (only for cashu-htlc mode). */
  htlc_hash?: string;
}

// --- Purchase Record ---

export interface PurchaseRecord {
  listing_id: string;
  token_hash: string;
  mode: PaymentMode;
  amount_sats: number;
  purchased_at: number;
}

// --- Hono Env (typed Variables for c.get/c.set) ---

export type MarketplaceEnv = {
  Variables: {
    paymentInfo: PaymentInfo;
  };
};

// --- Route Context ---

export interface MarketplaceRouteContext {
  listingStore: ListingStore;
  preimageStore?: PreimageStore;
  writeAuth: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
}
